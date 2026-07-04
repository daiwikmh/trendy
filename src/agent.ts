import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { jsonChat } from "./llm.js";
import { observe, serialize } from "./perception.js";
import { loadProfile, type Profile } from "./profile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ActionSchema = z.object({
  thought: z.string().default(""),
  action: z.enum(["fill", "select", "click", "scroll", "await_human", "done"]),
  idx: z.number().nullable().default(null),
  value: z.string().default(""),
  reason: z.string().default(""),
});
type Action = z.infer<typeof ActionSchema>;

// A human, not the agent, is the author of record: the agent must never click
// the final submit. It fills, then hands off.
const SUBMIT = /\b(submit|apply now|send application|finish)\b/i;

const SYSTEM = `You are brow, an agent filling a job application in a real browser. Each turn you see the page's interactive elements and the candidate profile. Choose exactly ONE next action as JSON:
{ "thought": string, "action": "fill"|"select"|"click"|"scroll"|"await_human"|"done", "idx": number|null, "value": string, "reason": string }

Rules:
- Fill text inputs/textareas with "fill" (idx + value). Ground every value in the profile — never invent facts. If a required field has no profile answer, skip it and note it in reason.
- Use "select" for native <select> dropdowns; value must match one of its listed options.
- Custom dropdowns are NOT <select>: they show as a combobox/button. To set one, "click" it to open — the options then appear on the NEXT turn as elements with a role of "option", which you click. Do not "fill" a custom dropdown, and do not click the same closed dropdown more than twice.
- Use "click" only for navigation, "next page", radio buttons, checkboxes, opening a dropdown, or choosing an option — NEVER to submit the application.
- When the form is filled, or the only thing left is a submit/apply button, choose "await_human" and summarize in reason what is filled and what still needs a human (submit, plus any fields you skipped).
- "scroll" reveals more of a long form. "done" only if there is genuinely nothing to do.
- Do not fill a field that already shows the correct current value.`;

export interface StepLog {
  n: number;
  action: Action;
  url: string;
}

export interface RunResult {
  status: "await_human" | "done" | "max_steps";
  steps: StepLog[];
  runDir: string;
}

export async function runApplication(
  url: string,
  opts: { headless?: boolean; maxSteps?: number; onStep?: (s: StepLog) => void; profile?: Profile } = {}
): Promise<RunResult> {
  const { headless = false, maxSteps = 25, onStep } = opts;
  const profile = opts.profile ?? loadProfile();
  const runDir = path.join(__dirname, "..", "data", "runs", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(runDir, { recursive: true });

  const browser: Browser = await chromium.launch({ headless });
  const page: Page = await browser.newPage({ viewport: { width: 1280, height: 900 } } as any);
  const steps: StepLog[] = [];
  let status: RunResult["status"] = "max_steps";
  const history: string[] = [];
  let lastSig = "";
  let repeats = 0;

  try {
    // esbuild (via tsx) wraps named fns with a __name helper; shim it as identity
    // so functions we run inside the page via evaluate don't ReferenceError.
    await page.addInitScript({ content: "globalThis.__name = globalThis.__name || function (f) { return f; };" });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1200);

    for (let n = 1; n <= maxSteps; n++) {
      const obs = await observe(page);
      await page.screenshot({ path: path.join(runDir, `step-${String(n).padStart(2, "0")}.png`) });

      let action: Action;
      try {
        action = await jsonChat(
          SYSTEM,
          [
            `Goal: fill this job application, then hand off to a human before submitting.`,
            `Page: ${obs.title} — ${obs.url}`,
            ``,
            `Candidate profile:\n${JSON.stringify(profile, null, 2)}`,
            ``,
            `Interactive elements:\n${serialize(obs)}`,
            ``,
            history.length ? `Actions so far:\n${history.slice(-8).join("\n")}` : `No actions yet.`,
          ].join("\n"),
          ActionSchema
        );
      } catch (err) {
        // A single unusable model reply must never sink a run that's deep into a form.
        // Note it and move on; the next observation re-grounds us.
        console.warn(`  ! step ${n}: could not get a valid action (${String(err).split("\n")[0]}); skipping.`);
        history.push(`${n}. (skipped — model returned no valid action)`);
        await page.mouse.wheel(0, 400);
        continue;
      }

      // Hard safety net: if the model targets a submit control, override to human gate.
      const target = action.idx != null ? obs.elements.find((e) => e.idx === action.idx) : undefined;
      if (action.action === "click" && target && SUBMIT.test(`${target.text} ${target.label}`)) {
        action.action = "await_human";
        action.reason = `Reached submit control ("${target.text || target.label}"). Handing off — a human must submit.`;
      }

      // Loop-guard: if the agent repeats the same action with no progress, it is
      // stuck (usually a widget it can't operate) — hand off rather than spin.
      const sig = `${action.action}:${action.idx}:${action.value}`;
      repeats = sig === lastSig ? repeats + 1 : 0;
      lastSig = sig;
      if (repeats >= 3 && action.action !== "await_human") {
        action.action = "await_human";
        action.reason = `Stuck repeating the same action on ${target?.label || `element ${action.idx}`} — likely a widget I can't operate. Handing off to a human.`;
      }

      const log: StepLog = { n, action, url: obs.url };
      steps.push(log);
      history.push(`${n}. ${action.action}${action.idx != null ? ` [${action.idx}]` : ""}${action.value ? ` = ${JSON.stringify(action.value.slice(0, 40))}` : ""}${action.reason ? ` — ${action.reason}` : ""}`);
      onStep?.(log);

      if (action.action === "await_human" || action.action === "done") {
        status = action.action;
        break;
      }
      await execute(page, action);
      await page.waitForTimeout(700);
    }

    writeFileSync(path.join(runDir, "trace.json"), JSON.stringify({ url, status, steps }, null, 2));
    return { status, steps, runDir };
  } finally {
    // Keep the window open on a human gate so the person can take over.
    if (status !== "await_human") await browser.close();
  }
}

async function execute(page: Page, action: Action): Promise<void> {
  if (action.idx == null) return;
  const sel = `[data-brow-idx="${action.idx}"]`;
  const el = page.locator(sel);
  try {
    if (action.action === "fill") {
      await el.scrollIntoViewIfNeeded();
      await el.fill(action.value, { timeout: 8000 });
    } else if (action.action === "select") {
      await el.selectOption({ label: action.value }, { timeout: 8000 }).catch(() => el.selectOption(action.value, { timeout: 8000 }));
    } else if (action.action === "click") {
      await el.scrollIntoViewIfNeeded();
      await el.click({ timeout: 8000 });
    } else if (action.action === "scroll") {
      await page.mouse.wheel(0, 800);
    }
  } catch (err) {
    // A failed action is not fatal — the next observation reflects reality and the loop adapts.
    console.warn(`  ! action ${action.action}[${action.idx}] failed: ${String(err).split("\n")[0]}`);
  }
}

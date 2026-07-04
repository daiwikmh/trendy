import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { jsonChat } from "../shared/llm.js";
import { observeContent, serializeContent } from "../shared/perception.js";
import { analyzeLook, visionEnabled } from "../shared/vision.js";
import { sendPhoto, telegramConfigured } from "./telegram.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ActionSchema = z.object({
  thought: z.string().default(""),
  action: z.enum(["capture", "click", "scroll", "goto", "done"]),
  idx: z.number().nullable().default(null),
  url: z.string().default(""),
  caption: z.string().default(""),
  reason: z.string().default(""),
});
type Action = z.infer<typeof ActionSchema>;

const SYSTEM = `You are trendy, a fashion trend scout browsing an editorial fashion site in a real browser. Your job: find striking, on-topic design looks and CAPTURE them (a screenshot is sent to the user's Telegram).

Each turn you see IMAGES (with any heading/caption/alt text) and CONTROLS (links/buttons). Choose exactly ONE action as JSON:
{ "thought": string, "action": "capture"|"click"|"scroll"|"goto"|"done", "idx": number|null, "url": string, "caption": string, "reason": string }

Rules:
- "capture" a single image that looks like a genuine on-topic outfit/look. A vision model then verifies the ACTUAL image against the request (garment type, colors, gender) — if it doesn't truly match, the capture is rejected and not sent, so don't waste captures on maybes.
- Strongly prefer opening an article/lookbook first and capturing its large editorial/runway photo of a worn outfit — those match far better than small listing thumbnails.
- Never capture logos, ads, author avatars, UI chrome, product-only flatlays, or images with no person wearing the look. Never capture the same image twice.
- "click" a control to open an article/lookbook or load more items. "scroll" to reveal more. "goto" a URL if you need a different page.
- "done" when you have captured enough good looks for the topic.`;

export interface CaptureLog {
  n: number;
  caption: string;
  delivered: "telegram" | "saved";
  file: string;
}

export interface ScoutResult {
  captures: CaptureLog[];
  steps: number;
  runDir: string;
}

export async function scoutTrends(
  topic: string,
  opts: {
    startUrl?: string;
    headless?: boolean;
    maxSteps?: number;
    target?: number;
    onEvent?: (msg: string) => void;
    onCapture?: (c: CaptureLog) => void;
  } = {}
): Promise<ScoutResult> {
  const {
    startUrl = "https://hypebeast.com/fashion",
    headless = false,
    maxSteps = 30,
    target = 5,
    onEvent = (m) => console.log(m),
    onCapture,
  } = opts;

  const runDir = path.join(__dirname, "..", "..", "data", "captures", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(runDir, { recursive: true });
  const useTelegram = telegramConfigured();
  onEvent(`scouting "${topic}" — start: ${startUrl} — delivery: ${useTelegram ? "Telegram" : "saved to folder (Telegram not configured)"} — vision gate: ${visionEnabled() ? "on" : "off"}`);

  onEvent(`launching browser (${headless ? "headless" : "visible"})…`);
  const browser: Browser = await chromium.launch({ headless });
  const page: Page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const captures: CaptureLog[] = [];
  const capturedSrcs = new Set<string>();
  const history: string[] = [];
  let steps = 0;

  try {
    await page.addInitScript({ content: "globalThis.__name = globalThis.__name || function (f) { return f; };" });
    onEvent(`checking site: ${startUrl}`);
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500);
    onEvent(`page loaded — scanning for looks…`);

    for (let n = 1; n <= maxSteps && captures.length < target; n++) {
      steps = n;
      const obs = await observeContent(page);

      let action: Action;
      try {
        action = await jsonChat(
          SYSTEM,
          [
            `Topic: ${topic}`,
            `Captured so far: ${captures.length}/${target}${captures.length ? " — " + captures.map((c) => c.caption).join(" | ") : ""}`,
            `Page: ${obs.title} — ${obs.url}`,
            ``,
            serializeContent(obs),
            ``,
            history.length ? `Recent actions:\n${history.slice(-6).join("\n")}` : `No actions yet.`,
          ].join("\n"),
          ActionSchema
        );
      } catch (err) {
        onEvent(`  ! step ${n}: no valid action (${String(err).split("\n")[0]}); scrolling on.`);
        await page.mouse.wheel(0, 700);
        continue;
      }

      if (action.action === "done") {
        onEvent(`step ${n}: done — ${action.reason || "enough captured"}`);
        break;
      }

      if (action.action === "capture" && action.idx != null) {
        const img = obs.images.find((e) => e.idx === action.idx);
        if (!img || capturedSrcs.has(img.src)) {
          history.push(`${n}. capture[${action.idx}] skipped (already captured or not an image)`);
          continue;
        }
        capturedSrcs.add(img.src); // mark seen either way, so we don't re-evaluate it
        try {
          onEvent(`step ${n}: 📸 screenshotting candidate…`);
          const shot = await page
            .locator(`[data-trendy-idx="${action.idx}"]`)
            .screenshot({ type: "jpeg", quality: 78, timeout: 8000 });

          // Vision gate: does the actual image match the request (tag/colors/gender)?
          const analysis = await analyzeLook(shot, topic);
          if (analysis && !analysis.matches) {
            onEvent(
              `  ✗ rejected — ${analysis.is_look ? `${analysis.gender} · ${analysis.tags.join(", ") || "look"}` : "not a wearable look"} doesn't match "${topic}"`
            );
            history.push(`${n}. rejected capture[${action.idx}] — vision mismatch (${analysis.gender}/${analysis.tags.join(",")})`);
            continue;
          }
          if (analysis) {
            onEvent(`  ✓ verified — ${analysis.gender} · ${analysis.tags.join(", ")}`);
          } else if (visionEnabled()) {
            onEvent(`  ⚠ vision unavailable — sending unverified`);
          }

          // Caption from what's actually in the frame (vision) when available.
          const shortCaption = analysis?.caption || `${action.caption}${visionEnabled() ? " (unverified)" : ""}`;
          const meta = analysis
            ? `\n${analysis.gender} · ${analysis.colors.join("/")} · ${analysis.tags.join(", ")}`
            : "";
          const file = path.join(runDir, `capture-${String(captures.length + 1).padStart(2, "0")}.jpg`);
          writeFileSync(file, shot);

          let delivered: CaptureLog["delivered"] = "saved";
          if (useTelegram) {
            onEvent(`  ✓ match — sending to Telegram…`);
            await sendPhoto(shot, `${shortCaption}${meta}\n\n${obs.title} — ${obs.url}`);
            onEvent(`  ✓ sent to Telegram — ${shortCaption}`);
            delivered = "telegram";
          } else {
            onEvent(`  ✓ match — saved ${path.basename(file)} — ${shortCaption}`);
          }
          const log: CaptureLog = { n, caption: shortCaption, delivered, file };
          captures.push(log);
          onCapture?.(log);
          history.push(`${n}. captured "${shortCaption.slice(0, 50)}"`);
        } catch (err) {
          onEvent(`  ! capture failed: ${String(err).split("\n")[0]}`);
          history.push(`${n}. capture[${action.idx}] failed`);
        }
        continue;
      }

      // navigation
      history.push(`${n}. ${action.action}${action.idx != null ? ` [${action.idx}]` : ""}${action.url ? ` ${action.url}` : ""}${action.reason ? ` — ${action.reason}` : ""}`);
      onEvent(`step ${n}: ${action.action}${action.idx != null ? ` [${action.idx}]` : ""}${action.reason ? ` — ${action.reason}` : ""}`);
      try {
        if (action.action === "click" && action.idx != null) {
          await page.locator(`[data-trendy-idx="${action.idx}"]`).click({ timeout: 8000 });
          await page.waitForTimeout(1200);
        } else if (action.action === "goto" && action.url) {
          await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 45000 });
          await page.waitForTimeout(1200);
        } else if (action.action === "scroll") {
          await page.mouse.wheel(0, 900);
          await page.waitForTimeout(600);
        }
      } catch (err) {
        onEvent(`  ! ${action.action} failed: ${String(err).split("\n")[0]}`);
      }
    }

    writeFileSync(path.join(runDir, "captures.json"), JSON.stringify({ topic, startUrl, captures }, null, 2));
    return { captures, steps, runDir };
  } finally {
    await browser.close();
  }
}

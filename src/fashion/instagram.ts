import { execFile } from "child_process";
import { promisify } from "util";
import { writeFileSync, readFileSync, rmSync } from "fs";
import path from "path";
import os from "os";
import { analyzeLook } from "../shared/vision.js";
import { sendPhoto, telegramConfigured } from "./telegram.js";
import type { CaptureLog, FallbackCandidate } from "./fashion.js";

const execFileAsync = promisify(execFile);

// Shells out to the `webcmd` CLI (@agentrhq/webcmd) — a browser-automation
// tool with a built-in Google adapter and generic browser session commands.
// Instagram's own read commands (search/download/whoami) need a logged-in
// session, but opening a public profile/post URL directly and dismissing the
// signup dialog works without auth, so we drive that path with `browser`.
async function webcmd(args: string[], timeoutMs = 45000): Promise<any> {
  try {
    const { stdout } = await execFileAsync("webcmd", args, { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 });
    try {
      return JSON.parse(stdout);
    } catch {
      return stdout;
    }
  } catch (err: any) {
    if (typeof err?.stdout === "string" && err.stdout.trim()) {
      try {
        return JSON.parse(err.stdout);
      } catch {
        return err.stdout;
      }
    }
    throw err;
  }
}

// Path segments that look like a username but aren't — Instagram's own SEO
// landing pages (/popular/<slug>/) and non-profile sections.
const IG_SKIP_SEGMENTS = new Set([
  "p", "reel", "reels", "explore", "accounts", "tv", "stories", "direct",
  "about", "legal", "developer", "popular", "tags", "web",
]);

export interface InstagramHit {
  kind: "post" | "profile";
  url: string;
  user: string;
}

function parseInstagramHit(rawUrl: string): InstagramHit | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!u.hostname.endsWith("instagram.com")) return null;
  const segs = u.pathname.split("/").filter(Boolean);
  if (segs.length === 0) return null;

  // canonical post/reel permalink: /p/<code>/ or /reel/<code>/
  if ((segs[0] === "p" || segs[0] === "reel") && segs[1]) {
    return { kind: "post", url: `https://www.instagram.com/${segs[0]}/${segs[1]}/`, user: "" };
  }
  // username-prefixed post/reel: /<user>/p/<code>/ or /<user>/reel/<code>/
  if (segs.length >= 3 && (segs[1] === "p" || segs[1] === "reel")) {
    return { kind: "post", url: `https://www.instagram.com/${segs[0]}/${segs[1]}/${segs[2]}/`, user: segs[0] };
  }
  // plain profile root: /<user>/
  if (segs.length === 1 && !IG_SKIP_SEGMENTS.has(segs[0].toLowerCase())) {
    return { kind: "profile", url: `https://www.instagram.com/${segs[0]}/`, user: segs[0] };
  }
  return null;
}

// Finds real Instagram posts/profiles relevant to the topic via `webcmd google search`.
export async function findInstagramTargets(topic: string, limit = 6): Promise<InstagramHit[]> {
  const results = await webcmd(["google", "search", `${topic} instagram`, "-f", "json"]);
  const seen = new Set<string>();
  const hits: InstagramHit[] = [];
  for (const r of Array.isArray(results) ? results : []) {
    const hit = parseInstagramHit(r?.url ?? "");
    if (!hit || seen.has(hit.url)) continue;
    seen.add(hit.url);
    hits.push(hit);
    if (hits.length >= limit) break;
  }
  return hits;
}

export async function findArticleUrls(topic: string, domains: string[], limit = 5): Promise<string[]> {
  const results = await webcmd(["google", "search", topic, "-f", "json"]);
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(results) ? results : []) {
    const url: string = r?.url ?? "";
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (!domains.some((d) => host === d || host.endsWith(`.${d}`))) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
      if (urls.length >= limit) break;
    } catch {
      continue;
    }
  }
  return urls;
}

async function dismissSignupDialog(session: string): Promise<void> {
  try {
    await webcmd(["browser", session, "click", "svg[aria-label='Close']"], 5000);
  } catch {
    // no dialog present — nothing to do
  }
}

async function listPostUrls(session: string, limit = 8): Promise<string[]> {
  const found = await webcmd(["browser", session, "find", "--css", "a[href*='/p/'], a[href*='/reel/']", "--limit", String(limit)]);
  const hrefs: string[] = (found?.entries ?? []).map((e: any) => e?.attrs?.href).filter(Boolean);
  return [...new Set(hrefs)].map((href) => `https://www.instagram.com${href}`);
}

export interface InstagramScoutOpts {
  target: number;
  runDir: string;
  onEvent: (msg: string) => void;
  onCapture?: (c: CaptureLog) => void;
  capturedSrcs: Set<string>;
  captureOffset: number;
  fallbackCandidates: FallbackCandidate[];
  deadline?: number;
}

function postImageVariants(postUrl: string): string[] {
  if (postUrl.includes("img_index=") || /\/reel\//.test(postUrl)) return [postUrl];
  const base = postUrl.split("?")[0];
  return [`${base}?img_index=2`, `${base}?img_index=3`, base];
}

async function grabScreenshot(session: string, url: string, n: number): Promise<Buffer> {
  await webcmd(["browser", session, "open", url]);
  await dismissSignupDialog(session);
  const tmpFile = path.join(os.tmpdir(), `trendy-ig-${Date.now()}-${n}.jpg`);
  await webcmd(["browser", session, "screenshot", tmpFile]);
  const shot = readFileSync(tmpFile);
  rmSync(tmpFile, { force: true });
  return shot;
}

async function capturePost(
  session: string,
  postUrl: string,
  user: string,
  topic: string,
  n: number,
  runDir: string,
  useTelegram: boolean,
  onEvent: (msg: string) => void,
  fallbackCandidates: FallbackCandidate[],
  deadline?: number
): Promise<CaptureLog | null> {
  for (const url of postImageVariants(postUrl)) {
    if (deadline && Date.now() >= deadline) break;
    try {
      const shot = await grabScreenshot(session, url, n);
      const analysis = await analyzeLook(shot, topic);
      if (analysis && !analysis.matches) {
        onEvent(`  ✗ rejected — doesn't match "${topic}" (${url})`);
        if (analysis.is_look) {
          fallbackCandidates.push({ shot, caption: analysis.caption || `Instagram @${user} look`, source: url, gender: analysis.gender });
        }
        continue;
      }

      const shortCaption = analysis?.caption || (user ? `Instagram @${user} look` : "Instagram look");
      const file = path.join(runDir, `capture-${String(n).padStart(2, "0")}.jpg`);
      writeFileSync(file, shot);

      let delivered: CaptureLog["delivered"] = "saved";
      if (useTelegram) {
        await sendPhoto(shot, `${shortCaption}\n\nInstagram${user ? ` @${user}` : ""} — ${url}`);
        delivered = "telegram";
      }
      onEvent(`  ✓ captured — ${shortCaption}`);
      return { n, caption: shortCaption, delivered, file };
    } catch (err) {
      onEvent(`  ! post failed: ${String((err as Error).message).split("\n")[0]}`);
    }
  }
  return null;
}

// Scans public Instagram posts/profiles for on-topic looks: discover targets
// via Google search, open each (dismissing the signup wall as needed), and
// run the same vision gate / Telegram delivery as the site scout.
export async function scoutInstagram(topic: string, opts: InstagramScoutOpts): Promise<CaptureLog[]> {
  const { target, runDir, onEvent, onCapture, capturedSrcs, captureOffset, fallbackCandidates, deadline } = opts;
  const captures: CaptureLog[] = [];
  const session = `trendy-ig-${Date.now()}`;
  const useTelegram = telegramConfigured();

  try {
    onEvent(`searching Google for Instagram posts about "${topic}"…`);
    const hits = await findInstagramTargets(topic, 6);
    if (!hits.length) {
      onEvent(`  no Instagram results found for "${topic}"`);
      return captures;
    }
    onEvent(`  found ${hits.length} candidate(s): ${hits.map((h) => (h.kind === "profile" ? `@${h.user}` : h.url)).join(", ")}`);

    for (const hit of hits) {
      if (captures.length >= target) break;
      if (deadline && Date.now() >= deadline) break;

      const postUrls = hit.kind === "post" ? [hit.url] : [];
      if (hit.kind === "profile") {
        onEvent(`checking instagram.com/${hit.user}`);
        try {
          await webcmd(["browser", session, "open", hit.url]);
        } catch (err) {
          onEvent(`  ! failed to open @${hit.user}: ${String((err as Error).message).split("\n")[0]}`);
          continue;
        }
        await dismissSignupDialog(session);
        const found = await listPostUrls(session, 8);
        onEvent(`  found ${found.length} post(s)`);
        postUrls.push(...found);
      }

      for (const postUrl of postUrls) {
        if (captures.length >= target) break;
        if (deadline && Date.now() >= deadline) break;
        const baseId = postUrl.split("?")[0];
        if (capturedSrcs.has(baseId)) continue;
        capturedSrcs.add(baseId);

        const n = captureOffset + captures.length + 1;
        const log = await capturePost(session, postUrl, hit.user, topic, n, runDir, useTelegram, onEvent, fallbackCandidates, deadline);
        if (log) {
          captures.push(log);
          onCapture?.(log);
        }
      }
    }
  } finally {
    await webcmd(["browser", session, "close"], 10000).catch(() => {});
  }

  return captures;
}

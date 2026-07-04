import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { QAEntry } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

export type Profile = Record<string, unknown>;

// Candidate facts the field resolver draws on: a base profile.json plus every
// answer banked during the voice onboarding interview.
export function loadProfile(): Profile {
  const base: Profile = existsSync(path.join(DATA_DIR, "profile.json"))
    ? JSON.parse(readFileSync(path.join(DATA_DIR, "profile.json"), "utf8"))
    : {};
  const qaPath = path.join(DATA_DIR, "qa_bank.json");
  if (existsSync(qaPath)) {
    const qa: QAEntry[] = JSON.parse(readFileSync(qaPath, "utf8"));
    for (const e of qa) base[e.field] ??= e.answer;
  }
  return base;
}

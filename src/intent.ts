import { z } from "zod";
import { jsonChat } from "./llm.js";
import { JobRequestSchema, type JobRequest } from "./types.js";

export type Interpretation =
  | { kind: "command"; job: JobRequest }
  | { kind: "chat"; reply: string };

const RawSchema = z.object({
  kind: z.enum(["command", "chat"]).default("chat"),
  reply: z.string().default(""),
  job: z.any().nullable().default(null),
});

const SYSTEM = `You are brow, a voice assistant that applies to jobs on the user's behalf. Classify each spoken utterance. Output ONLY a JSON object:
{
  "kind": "command" | "chat",
  "reply": string,   // for "chat": a short, spoken-friendly answer. Empty for "command".
  "job": {           // for "command" only; null for "chat"
    "roles": string[],              // MUST be non-empty for a command
    "companies_or_urls": string[],
    "constraints": { "locations": string[], "remote": boolean|null, "min_salary": string|null, "other": string[] },
    "max_applications": number      // default 5
  } | null
}

Use "command" ONLY when the user is actually asking you to apply to jobs and names at least one role (e.g. "apply to 3 backend roles at Stripe, remote only"). Speech-to-text may garble names; keep them as heard. Never invent a role the user didn't say.

Use "chat" for greetings, questions, small talk, or "what can you do" — anything that is not an actionable apply-to-jobs command. For "what can you do", explain briefly: you apply to jobs by voice — say a role and how many applications, optionally companies and constraints like remote or location, then you fill the forms and pause for a human review before submitting. Keep replies to one or two sentences, natural when read aloud.`;

export async function interpret(transcript: string): Promise<Interpretation> {
  const raw = await jsonChat(SYSTEM, transcript, RawSchema);
  if (raw.kind === "command") {
    const parsed = JobRequestSchema.safeParse(raw.job);
    if (parsed.success) return { kind: "command", job: parsed.data };
  }
  return {
    kind: "chat",
    reply:
      raw.reply ||
      "I apply to jobs for you by voice. Tell me a role and how many applications — for example, apply to three backend roles at Stripe, remote only.",
  };
}

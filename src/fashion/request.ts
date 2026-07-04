import { z } from "zod";
import { jsonChat } from "../shared/llm.js";

export const FashionRequestSchema = z.object({
  topic: z.string().min(1),
  count: z.number().int().positive().max(15).default(5),
  start_url: z.string().nullable().default(null),
});
export type FashionRequest = z.infer<typeof FashionRequestSchema>;

const SYSTEM = `You turn a spoken or typed request to browse fashion trends into JSON. Output ONLY a JSON object:
{ "topic": string, "count": number, "start_url": string | null }
- topic: the fashion theme to look for, kept specific to the user's intent (e.g. "summer 2026 menswear streetwear").
- count: how many looks to capture; default 3 if the user didn't say.
- start_url: a site URL only if the user explicitly named one, otherwise null.
Do not invent constraints the user did not express.`;

// Natural language request
export async function interpretFashionRequest(text: string): Promise<FashionRequest> {
  const fallback: FashionRequest = { topic: text, count: 3, start_url: null };
  const timeout = new Promise<FashionRequest>((_, reject) =>
    setTimeout(() => reject(new Error("interpret timeout")), 7000)
  );
  try {
    return await Promise.race([jsonChat(SYSTEM, text, FashionRequestSchema), timeout]);
  } catch {
    return fallback;
  }
}

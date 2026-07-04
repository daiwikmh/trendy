import OpenAI from "openai";
import { z } from "zod";

const llm = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY ?? "unset",
  baseURL: "https://integrate.api.nvidia.com/v1",
});

const MODEL = "z-ai/glm-5.2";

function extractJson(raw: string): unknown {
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`no JSON object in: ${raw.slice(0, 160)}`);
  s = s.slice(start, end + 1).replace(/,(\s*[}\]])/g, "$1"); // drop trailing commas
  return JSON.parse(s);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retry rate-limits / transient 5xx with exponential backoff (NVIDIA's free tier throttles).
async function completeWithBackoff(messages: any[], temperature: number) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await llm.chat.completions.create({ model: MODEL, temperature, max_tokens: 2048, messages });
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      if ((status === 429 || (status >= 500 && status < 600)) && attempt < 4) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }
}

export async function jsonChat<T>(
  system: string,
  user: string,
  schema: z.ZodType<T>,
  tries = 2
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    const completion = await completeWithBackoff(
      [
        { role: "system", content: system },
        { role: "user", content: user },
        ...(i > 0
          ? [{ role: "system", content: "Your previous reply was not valid JSON. Return ONLY a single valid JSON object, no prose, no code fences." }]
          : []),
      ],
      i === 0 ? 0.2 : 0.5
    );
    try {
      return schema.parse(extractJson(completion.choices[0]?.message?.content ?? ""));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

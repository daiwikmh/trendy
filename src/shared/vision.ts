//Set VISION=0 to disable, NVIDIA_VISION_MODEL to swap models.
const VISION_MODEL = process.env.NVIDIA_VISION_MODEL ?? "meta/llama-3.2-11b-vision-instruct";
const VISION_ENABLED = process.env.VISION !== "0";
const URL = "https://integrate.api.nvidia.com/v1/chat/completions";

export interface LookAnalysis {
  is_look: boolean;
  gender: "men" | "women" | "unisex" | "unknown";
  colors: string[];
  tags: string[];
  matches: boolean;
  caption: string;
}

export function visionEnabled(): boolean {
  return VISION_ENABLED;
}

export function inferGender(topic: string): "men" | "women" | null {
  const t = topic.toLowerCase();
  if (/\b(men|man|male|mens|guys|him|his)\b/.test(t)) return "men";
  if (/\b(women|woman|female|womens|girls|her|hers)\b/.test(t)) return "women";
  return null;
}

function prompt(request: string): string {
  return `You are shown ONE image from a fashion website. The user asked for: "${request}".
Judge ONLY from what is actually visible in the image — do not guess from context.
Return ONLY a JSON object:
{
  "is_look": boolean,        // true only if it shows real clothing worn as an outfit or a clear garment; false for logos, ads, banners, text graphics, product packaging, faces/headshots, or unrelated photos
  "gender": "men" | "women" | "unisex" | "unknown",   // who the look is presented for
  "colors": string[],        // up to 4 dominant clothing colors you actually see
  "tags": string[],          // garment/style words you actually see, e.g. "hoodie","cargo pants","streetwear","tailoring","sneakers"
  "matches": boolean,        // true ONLY if is_look is true AND the gender and style genuinely fit the user's request
  "caption": string          // one vivid sentence describing the real outfit in the image
}`;
}

function extractJson(raw: string): unknown {
  const s = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  return JSON.parse(s.replace(/,(\s*[}\]])/g, "$1"));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function analyzeLook(jpeg: Buffer, request: string): Promise<LookAnalysis | null> {
  if (!VISION_ENABLED) return null;
  const b64 = jpeg.toString("base64");
  if (b64.length > 5_000_000) return null; // too large for inline API — skip the gate gracefully

  const body = JSON.stringify({
    model: VISION_MODEL,
    max_tokens: 320,
    temperature: 0.1,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt(request) },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
        ],
      },
    ],
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.NVIDIA_API_KEY ?? ""}`,
          "Content-Type": "application/json",
        },
        body,
      });
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < 2) {
          await sleep(800 * 2 ** attempt);
          continue;
        }
        return null;
      }
      const data = await res.json();
      const raw: string = data?.choices?.[0]?.message?.content ?? "";
      const a = extractJson(raw) as Partial<LookAnalysis>;
      return {
        is_look: !!a.is_look,
        gender: (a.gender as LookAnalysis["gender"]) ?? "unknown",
        colors: Array.isArray(a.colors) ? a.colors.slice(0, 4) : [],
        tags: Array.isArray(a.tags) ? a.tags.slice(0, 6) : [],
        matches: !!a.matches,
        caption: typeof a.caption === "string" ? a.caption : "",
      };
    } catch {
      if (attempt < 2) {
        await sleep(800 * 2 ** attempt);
        continue;
      }
      return null;
    }
  }
  return null;
}

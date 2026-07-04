import { deepgram } from "./deepgram.js";

export async function synthesize(text: string): Promise<Buffer> {
  const response = await deepgram().speak.request(
    { text },
    { model: "aura-2-thalia-en", encoding: "mp3" }
  );
  const stream = await response.getStream();
  if (!stream) throw new Error("Deepgram TTS returned no audio");
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

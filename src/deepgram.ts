import { createClient, type DeepgramClient } from "@deepgram/sdk";

let client: DeepgramClient | null = null;

export function deepgram(): DeepgramClient {
  if (!client) {
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) throw new Error("DEEPGRAM_API_KEY is not set");
    client = createClient(key);
  }
  return client;
}

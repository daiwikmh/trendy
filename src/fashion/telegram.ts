export function telegramConfigured(): boolean {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export async function sendPhoto(image: Buffer, caption: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set");

  const form = new FormData();
  form.append("chat_id", chat);
  form.append("caption", caption.slice(0, 1024));
  form.append("photo", new Blob([new Uint8Array(image)], { type: "image/jpeg" }), "look.jpg");

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`Telegram sendPhoto failed: ${res.status} ${await res.text()}`);
}

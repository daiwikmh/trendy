# trendy

Point an AI agent at real fashion sources by voice or by typing, and it finds the
on-topic looks worth knowing, verifies them with a vision model, and sends them
straight to Telegram.

The UI lives in `trendy/app/` (Next.js); the agent and voice layer live in `src/`
(a plain Node/Express + WebSocket backend). They're two separate processes that talk
over a WebSocket — the UI streams live status and captures while the agent works.

## Pipeline

1. **Request** — a spoken or typed request from the UI is transcribed (Deepgram) and
   parsed by an LLM into a scout request: `{ topic, count, start_url }`.
2. **Instagram first** — `webcmd` (the `@agentrhq/webcmd` CLI) runs a Google search for
   `"<topic> instagram"`, extracts public post/profile URLs, opens each in a headless
   browser, and dismisses the signup wall. Carousel posts lead with a description/cover
   card, so it tries `?img_index=2`/`3` to reach the actual looks.
3. **Vision gate** — every candidate screenshot is checked by a VLM against the request
   (garment, colors, gender). Non-matches are rejected, not sent.
4. **Site fallback** — if Instagram doesn't fill the target count, a visible Playwright
   browser opens topic-relevant editorial articles (discovered via Google across
   Hypebeast, Highsnobiety, Vogue, WWD, Dazed, i-D, BoF), scanning and capturing looks.
   It auto-switches sites when a page stalls.
5. **Time budget** — the whole run is capped (~2 min). If it can't find a full match in
   time, it sends the closest look it did find, filtered by the gender in the query.
6. **Delivery** — matching looks are sent to Telegram (or saved locally if Telegram
   isn't configured).

## Features

- **Voice or text** — talk to it or type; requests are transcribed and interpreted by an LLM.
- **Instagram-first discovery** — finds relevant public posts/profiles via Google + `webcmd`, no login required.
- **Carousel-aware** — skips the description/cover card to grab the real looks (`img_index`).
- **Vision-verified** — a VLM confirms each look matches the topic, colors, and gender before it's sent.
- **Editorial fallback** — a live Playwright browser scouts fashion sites when Instagram comes up short, auto-switching when stuck.
- **Closest-match guarantee** — under a ~2 min budget; if nothing fully matches, it still sends the nearest look for the requested gender.
- **Telegram delivery** — captures are pushed to Telegram, or saved locally if unconfigured.
- **Live UI** — status and captures stream to the Next.js frontend over a WebSocket.
- **Audit trail** — every run saves `data/captures/<timestamp>/` with one screenshot per capture + `captures.json`.

# brow — L0 Voice Layer

Streaming voice front-end for the job-application agent. Two jobs:

1. **Command intent** — speak a request ("apply to 3 backend roles at Stripe and Ramp, remote only"); Deepgram streams STT, GLM-5.2 parses it into a typed `JobRequest`, and the agent narrates back what it heard via Deepgram Aura TTS.
2. **Onboarding interview** — paste a resume; the LLM finds gaps the resume doesn't answer (work authorization, notice period, expected comp…), asks them aloud one at a time, and writes each answer to a persistent Q&A bank (`data/qa_bank.json`) tagged `source: interview` so they're asked *once, ever*.

## Stack
- **STT/TTS:** Deepgram (`nova-3` streaming listen, `aura-2` speak) — SDK v4.
- **LLM:** GLM-5.2 via NVIDIA NIM, through the OpenAI SDK (`baseURL` override).
- **Server:** Express + `ws`; browser streams mic audio (WebM/Opus) over a WebSocket.

## Run
```bash
cp .env.example .env    # fill in DEEPGRAM_API_KEY and NVIDIA_API_KEY
npm install
npm run dev             # http://localhost:3000
```
The server boots without keys (prints warnings); voice/LLM calls return a clean error until keys are set.

## Layout
- `src/server.ts` — HTTP + WebSocket, per-connection session state machine (command ↔ interview).
- `src/intent.ts` — transcript → `JobRequest` (Zod-validated).
- `src/interview.ts` — resume → gap questions.
- `src/tts.ts` / `src/deepgram.ts` — Aura synthesis, lazy Deepgram client.
- `src/types.ts` — `JobRequest`, `GapQuestion`, `QAEntry` schemas.
- `public/index.html` — mic capture, live transcript, narration playback, review panes.

Next layers (L1 candidate world model, L2 orchestrator, L3 browser execution) build on the `JobRequest` and Q&A bank this layer produces.

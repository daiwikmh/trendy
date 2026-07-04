import "../shared/env.js";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { LiveTranscriptionEvents, type ListenLiveClient } from "@deepgram/sdk";
import { deepgram } from "./deepgram.js";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { findGaps } from "./interview.js";
import { synthesize } from "./tts.js";
import { interpretFashionRequest } from "../fashion/request.js";
import { scoutTrends, type CaptureLog } from "../fashion/fashion.js";
import type { GapQuestion, QAEntry } from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const QA_BANK = path.join(DATA_DIR, "qa_bank.json");
mkdirSync(DATA_DIR, { recursive: true });

for (const key of ["DEEPGRAM_API_KEY", "NVIDIA_API_KEY"]) {
  if (!process.env[key]) console.warn(`WARNING: ${key} is not set — related calls will fail.`);
}

const app = express();
app.use(express.json({ limit: "2mb" }));
// The UI now lives in trendy/app/ (a separate Next.js dev server), so this
// backend is API/WS-only — allow cross-origin requests from the Next dev origin.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.post("/tts", async (req, res) => {
  try {
    const audio = await synthesize(String(req.body.text ?? ""));
    res.type("audio/mpeg").send(audio);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

function saveAnswers(entries: QAEntry[]) {
  const existing: QAEntry[] = existsSync(QA_BANK)
    ? JSON.parse(readFileSync(QA_BANK, "utf8"))
    : [];
  writeFileSync(QA_BANK, JSON.stringify([...existing, ...entries], null, 2));
}

interface Session {
  mode: "command" | "interview";
  dg: ListenLiveClient | null;
  pendingAudio: Buffer[];
  finals: string[];
  lastInterim: string;
  questions: GapQuestion[];
  qIndex: number;
  answers: QAEntry[];
  scouting: boolean;
}

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws: WebSocket) => {
  const s: Session = {
    mode: "command",
    dg: null,
    pendingAudio: [],
    finals: [],
    lastInterim: "",
    questions: [],
    qIndex: 0,
    answers: [],
    scouting: false,
  };

  const send = (msg: object) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const narrate = (text: string) => send({ type: "narrate", text });
  const toArrayBuffer = (buf: Buffer): ArrayBuffer =>
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

  function startListening() {
    s.finals = [];
    s.lastInterim = "";
    s.pendingAudio = [];
    const dg = deepgram().listen.live({
      model: "nova-3",
      smart_format: true,
      interim_results: true,
    });
    s.dg = dg;
    dg.on(LiveTranscriptionEvents.Open, () => {
      for (const chunk of s.pendingAudio) dg.send(toArrayBuffer(chunk));
      s.pendingAudio = [];
    });
    dg.on(LiveTranscriptionEvents.Transcript, (data) => {
      const text: string = data.channel?.alternatives?.[0]?.transcript ?? "";
      if (!text) return;
      if (data.is_final) s.finals.push(text);
      else s.lastInterim = text;
      send({ type: "transcript", text: [...s.finals, data.is_final ? "" : text].join(" ").trim(), final: false });
    });
    dg.on(LiveTranscriptionEvents.Error, (err) => send({ type: "error", error: String(err) }));
  }

  async function stopListening() {
    const dg = s.dg;
    if (!dg) return;
    s.dg = null;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 1500);
      dg.on(LiveTranscriptionEvents.Close, () => {
        clearTimeout(t);
        resolve();
      });
      dg.requestClose();
    });
    const utterance = (s.finals.join(" ") || s.lastInterim).trim();
    send({ type: "transcript", text: utterance, final: true });
    if (!utterance) {
      narrate("I didn't catch that. Try again?");
      return;
    }
    if (s.mode === "command") await handleScoutRequest(utterance);
    else await handleAnswer(utterance);
  }

  async function handleScoutRequest(utterance: string) {
    if (s.scouting) {
      narrate("I'm still scouting the last request — one moment.");
      return;
    }
    send({ type: "status", text: "Interpreting request…" });
    try {
      const req = await interpretFashionRequest(utterance);
      send({ type: "status", text: "" });
      send({ type: "scout_request", data: req });
      narrate(
        `Got it — scouting "${req.topic}", up to ${req.count} looks. Opening a browser now…`
      );

      s.scouting = true;
      send({ type: "scout_started" });
      const result = await scoutTrends(req.topic, {
        startUrl: req.start_url ?? undefined,
        target: req.count,
        headless: process.env.HEADLESS === "1",
        onEvent: (text) => send({ type: "scout_status", text }),
        onCapture: (capture: CaptureLog) => {
          send({ type: "scout_capture", capture });
          narrate(`Captured a look: ${capture.caption}`);
        },
      });
      send({ type: "scout_done", captures: result.captures, steps: result.steps });
      narrate(
        result.captures.length
          ? `Done — captured ${result.captures.length} look${result.captures.length === 1 ? "" : "s"}${
              result.captures[0]?.delivered === "telegram" ? ", sent to your Telegram" : ", saved locally"
            }.`
          : "I browsed but didn't find a strong match — try a more specific topic."
      );
    } catch (err) {
      send({ type: "error", error: String(err) });
      narrate("Sorry, something went wrong while scouting. Could you try again?");
    } finally {
      s.scouting = false;
    }
  }

  async function handleAnswer(utterance: string) {
    const q = s.questions[s.qIndex];
    s.answers.push({
      field: q.field,
      question: q.question,
      answer: utterance,
      source: "interview",
      answered_at: new Date().toISOString(),
    });
    s.qIndex++;
    if (s.qIndex < s.questions.length) {
      askCurrentQuestion();
    } else {
      saveAnswers(s.answers);
      send({ type: "interview_done", answers: s.answers });
      s.mode = "command";
      narrate("That's everything I needed. Your profile is complete — you won't be asked these again.");
    }
  }

  function askCurrentQuestion() {
    const q = s.questions[s.qIndex];
    send({ type: "question", index: s.qIndex, total: s.questions.length, ...q });
    narrate(q.question);
  }

  ws.on("message", async (raw, isBinary) => {
    if (isBinary) {
      const buf = raw as Buffer;
      if (s.dg?.isConnected()) s.dg.send(toArrayBuffer(buf));
      else if (s.dg) s.pendingAudio.push(buf);
      return;
    }
    const msg = JSON.parse(raw.toString());
    try {
      if (msg.type === "start_listening") startListening();
      else if (msg.type === "stop_listening") await stopListening();
      else if (msg.type === "scout") {
        // Typed request from the UI, bypassing STT.
        send({ type: "transcript", text: String(msg.text ?? ""), final: true });
        await handleScoutRequest(String(msg.text ?? ""));
      } else if (msg.type === "resume") {
        send({ type: "status", text: "Reading your resume and finding gaps…" });
        s.questions = await findGaps(String(msg.text));
        s.qIndex = 0;
        s.answers = [];
        if (!s.questions.length) {
          narrate("Your resume covers everything I need. No questions.");
          return;
        }
        s.mode = "interview";
        narrate(
          `Thanks. I have ${s.questions.length} quick questions to complete your profile. First:`
        );
        askCurrentQuestion();
      }
    } catch (err) {
      send({ type: "error", error: String(err) });
    }
  });

  ws.on("close", () => s.dg?.requestClose());
});

const PORT = Number(process.env.PORT ?? 3000);
const onError = (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\nPort ${PORT} is already in use by another process. ` +
        `Run on a different port, e.g.  PORT=3002 npm run dev\n`
    );
    process.exit(1);
  }
  throw err;
};
server.on("error", onError);
wss.on("error", onError);
server.listen(PORT, () => console.log(`trendy L0 voice layer → http://localhost:${PORT}`));

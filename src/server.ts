import "./env.js";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { LiveTranscriptionEvents, type ListenLiveClient } from "@deepgram/sdk";
import { deepgram } from "./deepgram.js";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { interpret } from "./intent.js";
import { findGaps } from "./interview.js";
import { synthesize } from "./tts.js";
import type { GapQuestion, QAEntry } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const QA_BANK = path.join(DATA_DIR, "qa_bank.json");
mkdirSync(DATA_DIR, { recursive: true });

for (const key of ["DEEPGRAM_API_KEY", "NVIDIA_API_KEY"]) {
  if (!process.env[key]) console.warn(`WARNING: ${key} is not set — related calls will fail.`);
}

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

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
    if (s.mode === "command") await handleCommand(utterance);
    else await handleAnswer(utterance);
  }

  async function handleCommand(utterance: string) {
    send({ type: "status", text: "Thinking…" });
    try {
      const result = await interpret(utterance);
      send({ type: "status", text: "" });
      if (result.kind === "chat") {
        narrate(result.reply);
        return;
      }
      const job = result.job;
      send({ type: "job_request", data: job });
      const where = job.companies_or_urls.length
        ? ` at ${job.companies_or_urls.join(", ")}`
        : "";
      narrate(
        `Got it. Up to ${job.max_applications} applications for ${job.roles.join(" or ")}${where}. Say go when you're ready.`
      );
    } catch (err) {
      send({ type: "error", error: String(err) });
      narrate("Sorry, I couldn't parse that. Could you rephrase?");
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
      else if (msg.type === "resume") {
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
server.listen(PORT, () => console.log(`brow L0 voice layer → http://localhost:${PORT}`));

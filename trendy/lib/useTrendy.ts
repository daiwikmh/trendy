"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const BACKEND_HTTP =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const BACKEND_WS = BACKEND_HTTP.replace(/^http/, "ws") + "/ws";

export interface FashionRequest {
  topic: string;
  count: number;
  start_url: string | null;
}

export interface Capture {
  n: number;
  caption: string;
  delivered: "telegram" | "saved";
  file: string;
}

export type ScoutPhase = "idle" | "interpreting" | "scouting" | "done";

export type LogLevel = "cmd" | "info" | "net" | "capture" | "ok" | "err";
export interface LogLine {
  id: number;
  ts: number;
  level: LogLevel;
  text: string;
}

export function useTrendy() {
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);
  const logIdRef = useRef(0);

  const [connected, setConnected] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [transcriptFinal, setTranscriptFinal] = useState(true);
  const [status, setStatus] = useState("");
  const [narration, setNarration] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [scoutRequest, setScoutRequest] = useState<FashionRequest | null>(null);
  const [scoutPhase, setScoutPhase] = useState<ScoutPhase>("idle");
  const [scoutStatus, setScoutStatus] = useState("");
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [error, setError] = useState("");

  const log = useCallback((level: LogLevel, text: string) => {
    if (!text) return;
    setLogs((prev) => {
      const next = [...prev, { id: logIdRef.current++, ts: Date.now(), level, text }];
      return next.length > 300 ? next.slice(-300) : next;
    });
  }, []);

  const speak = useCallback(async (text: string) => {
    setNarration(text);
    try {
      const res = await fetch(`${BACKEND_HTTP}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return;
      const audio = new Audio(URL.createObjectURL(await res.blob()));
      setSpeaking(true);
      audio.onended = () => setSpeaking(false);
      await audio.play();
    } catch {
      setSpeaking(false);
    }
  }, []);

  useEffect(() => {
    closedRef.current = false;

    const connect = () => {
      const ws = new WebSocket(BACKEND_WS);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        log("net", `connected to trendy backend (${BACKEND_WS})`);
      };
      ws.onclose = () => {
        setConnected(false);
        if (closedRef.current) return;
        log("err", "disconnected — retrying in 2s…");
        reconnectRef.current = setTimeout(connect, 2000);
      };
      ws.onerror = () => {
        log("err", `cannot reach backend at ${BACKEND_WS} — is it running?`);
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        switch (msg.type) {
          case "transcript":
            setTranscript(msg.text);
            setTranscriptFinal(msg.final);
            if (msg.final && msg.text) log("cmd", msg.text);
            break;
          case "narrate":
            speak(msg.text);
            log("info", `🔊 ${msg.text}`);
            break;
          case "status":
            setStatus(msg.text);
            if (msg.text) log("info", msg.text);
            break;
          case "scout_request":
            setScoutRequest(msg.data);
            setScoutPhase("interpreting");
            setCaptures([]);
            log(
              "info",
              `interpreted → topic="${msg.data.topic}" · looks=${msg.data.count}${
                msg.data.start_url ? ` · ${msg.data.start_url}` : ""
              }`
            );
            break;
          case "scout_started":
            setScoutPhase("scouting");
            break;
          case "scout_status":
            setScoutStatus(msg.text);
            log("info", msg.text);
            break;
          case "scout_capture":
            setCaptures((prev) => [...prev, msg.capture]);
            log("capture", `captured — ${msg.capture.caption}`);
            break;
          case "scout_done":
            setScoutPhase("done");
            setScoutStatus("");
            log("ok", `done — ${msg.captures.length} look(s) in ${msg.steps} steps`);
            break;
          case "error":
            setError(msg.error);
            log("err", msg.error);
            break;
        }
      };
    };

    connect();
    return () => {
      closedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [speak, log]);

  const startMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
          e.data.arrayBuffer().then((b) => wsRef.current?.send(b));
        }
      };
      wsRef.current?.send(JSON.stringify({ type: "start_listening" }));
      recorder.start(250);
      setListening(true);
      setTranscript("");
      setError("");
      log("net", "🎙 listening…");
    } catch {
      setError("Microphone access denied.");
      log("err", "microphone access denied");
    }
  }, [log]);

  const stopMic = useCallback(() => {
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    streamRef.current = null;
    setListening(false);
    setTimeout(() => wsRef.current?.send(JSON.stringify({ type: "stop_listening" })), 300);
  }, []);

  const sendText = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      setError("");
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setError("Not connected to the backend — is `npm run dev` running?");
        log("err", "cannot send: backend not connected");
        return;
      }
      ws.send(JSON.stringify({ type: "scout", text: t }));
    },
    [log]
  );

  const stopScout = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "stop" }));
    log("net", "requested stop…");
  }, [log]);

  return {
    connected,
    listening,
    transcript,
    transcriptFinal,
    status,
    narration,
    speaking,
    scoutRequest,
    scoutPhase,
    scoutStatus,
    captures,
    logs,
    error,
    startMic,
    stopMic,
    sendText,
    stopScout,
  };
}

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

// Talks to the trendy backend (src/voice/server.ts) over the same WebSocket
// protocol the original voice UI used, plus the newer scout_* message types
// emitted by the fashion-scout flow.
export function useTrendy() {
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
  const [error, setError] = useState("");

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
    const ws = new WebSocket(BACKEND_WS);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      switch (msg.type) {
        case "transcript":
          setTranscript(msg.text);
          setTranscriptFinal(msg.final);
          break;
        case "narrate":
          speak(msg.text);
          break;
        case "status":
          setStatus(msg.text);
          break;
        case "scout_request":
          setScoutRequest(msg.data);
          setScoutPhase("interpreting");
          setCaptures([]);
          break;
        case "scout_started":
          setScoutPhase("scouting");
          break;
        case "scout_status":
          setScoutStatus(msg.text);
          break;
        case "scout_capture":
          setCaptures((prev) => [...prev, msg.capture]);
          break;
        case "scout_done":
          setScoutPhase("done");
          setScoutStatus("");
          break;
        case "error":
          setError(msg.error);
          break;
      }
    };
    return () => ws.close();
  }, [speak]);

  const startMic = useCallback(async () => {
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
  }, []);

  const stopMic = useCallback(() => {
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    streamRef.current = null;
    setListening(false);
    setTimeout(() => wsRef.current?.send(JSON.stringify({ type: "stop_listening" })), 300);
  }, []);

  const sendText = useCallback((text: string) => {
    if (!text.trim()) return;
    setError("");
    wsRef.current?.send(JSON.stringify({ type: "scout", text: text.trim() }));
  }, []);

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
    error,
    startMic,
    stopMic,
    sendText,
  };
}

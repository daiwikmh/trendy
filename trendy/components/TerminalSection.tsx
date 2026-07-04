"use client";

import { useEffect, useRef } from "react";
import { Square } from "lucide-react";
import type { LogLevel, useTrendy } from "@/lib/useTrendy";

type Trendy = ReturnType<typeof useTrendy>;

const LEVEL_COLOR: Record<LogLevel, string> = {
  cmd: "text-white",
  info: "text-white/60",
  net: "text-sky-300/80",
  capture: "text-fuchsia-300",
  ok: "text-emerald-300",
  err: "text-red-300",
};

const LEVEL_TAG: Record<LogLevel, string> = {
  cmd: "you",
  info: "···",
  net: "net",
  capture: "cap",
  ok: " ok",
  err: "err",
};

function time(ts: number) {
  return new Date(ts).toLocaleTimeString("en-GB", { hour12: false });
}

export default function TerminalSection({ trendy }: { trendy: Trendy }) {
  const { logs, connected, scoutPhase, stopScout } = trendy;
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const running = scoutPhase === "interpreting" || scoutPhase === "scouting";

  return (
    <section className="relative bg-black py-24 md:py-32 px-6 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.03)_0%,_transparent_70%)]" />
      <div className="relative max-w-4xl mx-auto">
        <p className="text-white/40 text-sm tracking-widest uppercase mb-4">
          Live activity
        </p>
        <h2 className="text-3xl md:text-5xl text-white tracking-tight mb-8">
          Watch it{" "}
          <span className="font-display italic text-white/50">think</span>.
        </h2>

        <div className="liquid-glass rounded-2xl overflow-hidden">
          {/* window chrome */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
            <span className="w-3 h-3 rounded-full bg-red-400/70" />
            <span className="w-3 h-3 rounded-full bg-yellow-400/70" />
            <span className="w-3 h-3 rounded-full bg-green-400/70" />
            <span className="ml-3 text-white/40 text-xs font-mono">trendy://scout</span>
            <span className="ml-auto flex items-center gap-2 text-xs font-mono">
              {running && (
                <button
                  onClick={stopScout}
                  className="flex items-center gap-1 rounded-full px-2.5 py-1 text-red-300 bg-red-400/10 hover:bg-red-400/20 transition-colors"
                  aria-label="Stop scouting"
                >
                  <Square className="w-2.5 h-2.5" fill="currentColor" />
                  stop
                </button>
              )}
              <span
                className={`w-2 h-2 rounded-full ${
                  connected ? "bg-emerald-400" : "bg-red-400"
                } ${running ? "animate-pulse" : ""}`}
              />
              <span className="text-white/40">
                {connected ? (running ? "running" : "connected") : "offline"}
              </span>
            </span>
          </div>

          {/* log body */}
          <div
            ref={bodyRef}
            className="h-80 md:h-96 overflow-y-auto px-4 py-4 font-mono text-[13px] leading-relaxed bg-black/40"
          >
            {logs.length === 0 ? (
              <p className="text-white/30">
                waiting for a command — type one in the box up top, e.g.{" "}
                <span className="text-white/60">
                  &ldquo;streetwear looks for summer 2026&rdquo;
                </span>
              </p>
            ) : (
              logs.map((l) => (
                <div key={l.id} className="flex gap-3 whitespace-pre-wrap break-words">
                  <span className="text-white/25 shrink-0 select-none">{time(l.ts)}</span>
                  <span className={`shrink-0 select-none ${LEVEL_COLOR[l.level]}`}>
                    [{LEVEL_TAG[l.level]}]
                  </span>
                  <span className={LEVEL_COLOR[l.level]}>{l.text}</span>
                </div>
              ))
            )}
            <div className="flex gap-2 text-white/60 mt-1">
              <span className="text-emerald-300">trendy&gt;</span>
              <span className="w-2 h-4 bg-white/70 animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

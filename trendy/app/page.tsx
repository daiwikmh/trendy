"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, ArrowRight, Mic, Square, Camera, Send } from "lucide-react";
import { useTrendy } from "@/lib/useTrendy";
import AboutSection from "@/components/AboutSection";
import FeaturedVideoSection from "@/components/FeaturedVideoSection";
import PhilosophySection from "@/components/PhilosophySection";
import ServicesSection from "@/components/ServicesSection";
import TerminalSection from "@/components/TerminalSection";

type Trendy = ReturnType<typeof useTrendy>;

const HERO_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260405_074625_a81f018a-956b-43fb-9aee-4d1508e30e6a.mp4";

const FADE_MS = 500;

function fadeOpacity(el: HTMLVideoElement, from: number, to: number, ms: number) {
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    el.style.opacity = String(from + (to - from) * t);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onCanPlay = () => {
      video.play().catch(() => {});
      fadeOpacity(video, 0, 1, FADE_MS);
    };
    const onTimeUpdate = () => {
      if (video.duration && video.duration - video.currentTime <= 0.55) {
        fadeOpacity(video, Number(video.style.opacity || 1), 0, FADE_MS);
      }
    };
    const onEnded = () => {
      video.style.opacity = "0";
      setTimeout(() => {
        video.currentTime = 0;
        video.play().catch(() => {});
        fadeOpacity(video, 0, 1, FADE_MS);
      }, 100);
    };

    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("ended", onEnded);
    };
  }, []);

  return (
    <video
      ref={videoRef}
      className="absolute inset-0 w-full h-full object-cover object-bottom"
      style={{ opacity: 0 }}
      muted
      autoPlay
      playsInline
      preload="auto"
      src={HERO_VIDEO}
    />
  );
}

function Navbar() {
  return (
    <header className="relative z-20 px-6 py-6">
      <nav className="liquid-glass max-w-6xl mx-auto rounded-full px-8 py-4 flex items-center justify-between">
        {/* Logo */}
        <a href="#" className="flex items-center gap-2">
          <Globe className="w-6 h-6 text-white" />
          <span className="text-lg font-semibold text-white tracking-tight">
            trendy
          </span>
        </a>

        <div className="hidden md:flex items-center gap-10">
          <a
            href="#about"
            className="text-sm text-white/70 hover:text-white transition-colors"
          >
            How it Works
          </a>

          <a
            href="#terminal"
            className="text-sm text-white/70 hover:text-white transition-colors"
          >
            Demo
          </a>

          <a
            href="#services"
            className="text-sm text-white/70 hover:text-white transition-colors"
          >
            About
          </a>
        </div>

        {/* CTA */}
        <a
          href="#terminal"
          className="rounded-full bg-white text-black px-5 py-2.5 text-sm font-medium hover:scale-[1.02] transition-transform"
        >
          Try Trendy
        </a>
      </nav>
    </header>
  );
}

function CommandPill({ trendy }: { trendy: Trendy }) {
  const {
    listening,
    transcript,
    status,
    narration,
    scoutRequest,
    scoutPhase,
    scoutStatus,
    captures,
    error,
    startMic,
    stopMic,
    sendText,
  } = trendy;

  const [text, setText] = useState("");

  const submit = () => {
    if (listening) return;
    if (text.trim()) {
      sendText(text);
      setText("");
    } else {
      startMic();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  const subtitle =
    (listening && transcript) ||
    narration ||
    "Stay updated with the latest news and insights. Subscribe to our newsletter today and never miss out on exciting updates.";

  return (
    <>
      <form
        className="max-w-xl w-full"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="liquid-glass rounded-full pl-6 pr-2 py-2 flex items-center gap-3">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={listening}
            placeholder={listening ? "Listening…" : "Try: streetwear looks for summer 2026"}
            className="flex-1 bg-transparent outline-none text-white placeholder:text-white/40"
          />
          <button
            type={listening ? "button" : "submit"}
            onClick={listening ? stopMic : undefined}
            className={`rounded-full p-3 text-black transition-colors ${
              listening ? "bg-white/90 animate-pulse" : "bg-white"
            }`}
            aria-label={listening ? "Stop listening" : text.trim() ? "Send request" : "Start talking"}
          >
            {listening ? (
              <Square className="w-5 h-5" fill="black" />
            ) : text.trim() ? (
              <ArrowRight className="w-5 h-5" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </button>
        </div>
      </form>

      <p className="text-white text-sm leading-relaxed px-4 max-w-xl min-h-[3em]">
        {subtitle}
      </p>
      {(status || scoutStatus) && (
        <p className="text-white/50 text-xs px-4 -mt-4">{status || scoutStatus}</p>
      )}
      {error && <p className="text-red-300 text-xs px-4 -mt-4">{error}</p>}

      {scoutRequest && scoutPhase !== "idle" && (
        <div className="liquid-glass rounded-2xl px-6 py-5 max-w-xl w-full mt-8 text-left">
          <p className="text-white/40 text-xs tracking-widest uppercase mb-2">
            Scouting &ldquo;{scoutRequest.topic}&rdquo;
          </p>
          <p className="text-white/70 text-sm mb-3">
            {scoutPhase === "interpreting" && "Interpreting your request…"}
            {scoutPhase === "scouting" &&
              "Browser is open — watching the site for looks worth capturing."}
            {scoutPhase === "done" &&
              `Done — ${captures.length} look${captures.length === 1 ? "" : "s"} captured.`}
          </p>
          {captures.length > 0 && (
            <ul className="space-y-2">
              {captures.map((c) => (
                <li key={c.n} className="flex items-start gap-2 text-sm text-white/80">
                  <span className="mt-0.5 text-white/40">
                    {c.delivered === "telegram" ? (
                      <Send className="w-3.5 h-3.5" />
                    ) : (
                      <Camera className="w-3.5 h-3.5" />
                    )}
                  </span>
                  <span>{c.caption}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

export default function Home() {
  const trendy = useTrendy();

  return (
    <>
      <div className="min-h-screen overflow-hidden relative flex flex-col bg-black">
        <HeroVideo />
        <Navbar />

        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-12 text-center -translate-y-[10%]">
          <h1 className="font-display text-7xl md:text-8xl lg:text-9xl text-white tracking-tight whitespace-nowrap mb-10">
            Know them <em className="italic">all</em>.
          </h1>

          <CommandPill trendy={trendy} />

          <a
            href="#about"
            className="liquid-glass rounded-full px-8 py-3 text-white text-sm font-medium hover:bg-white/5 transition-colors mt-8"
          >
            How it works
          </a>
        </div>

        <div className="relative z-10 flex justify-center gap-4 pb-12">
          <button
            className="liquid-glass rounded-full p-4 text-white/80 hover:text-white hover:bg-white/5 transition-all"
            aria-label="Captures"
          >
            <Camera className="w-5 h-5" />
          </button>
          <button
            className="liquid-glass rounded-full p-4 text-white/80 hover:text-white hover:bg-white/5 transition-all"
            aria-label="Telegram delivery"
          >
            <Send className="w-5 h-5" />
          </button>
          <button
            className="liquid-glass rounded-full p-4 text-white/80 hover:text-white hover:bg-white/5 transition-all"
            aria-label="Browse the web"
          >
            <Globe className="w-5 h-5" />
          </button>
        </div>
      </div>

      <TerminalSection trendy={trendy} />
      <AboutSection />
      <FeaturedVideoSection />
      <PhilosophySection />
      <div id="services">
        <ServicesSection />
      </div>
    </>
  );
}

"use client";

import { Mic, MicOff, Sun, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { useVoice, useVoiceActions } from "@/components/voice/provider";

// Nobody has talked for this long: let the screen sleep again and turn the mic off.
const IDLE_MS = 30 * 60_000;

type WakeLock = { release: () => Promise<void>; addEventListener: (t: "release", f: () => void) => void };

/**
 * Hands-free mode for the kitchen or the desk: the screen stays on (Screen Wake Lock), a big orb
 * shows HIVEMIND listening and speaking, and the latest exchange is shown in large text.
 */
export default function FocusPage() {
  return (
    <Suspense>
      <Focus />
    </Suspense>
  );
}

function Focus() {
  const voice = useVoice();
  const router = useRouter();
  const params = useSearchParams();
  const [awake, setAwake] = useState<"on" | "unsupported" | "off">("off");
  const [blocked, setBlocked] = useState(false);
  const lock = useRef<WakeLock | null>(null);
  const orb = useRef<HTMLDivElement | null>(null);
  const lastActive = useRef(0);
  const { start, stop, on, state, last } = voice;

  // Keep the screen on; browsers drop the lock when the page is hidden, so take it again on return.
  useEffect(() => {
    const api = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLock> } }).wakeLock;
    if (!api) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- only known in the browser, after mount
      setAwake("unsupported");
      return;
    }
    let alive = true;
    const take = async () => {
      if (document.visibilityState !== "visible" || lock.current) return;
      try {
        const l = await api.request("screen");
        if (!alive) return void l.release();
        lock.current = l;
        setAwake("on");
        l.addEventListener("release", () => {
          lock.current = null;
          if (alive) setAwake("off");
        });
      } catch {
        setAwake("off");
      }
    };
    void take();
    document.addEventListener("visibilitychange", take);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", take);
      void lock.current?.release();
      lock.current = null;
    };
  }, []);

  // "Talk now" (home-screen shortcut): start listening right away. Without a tap the browser may refuse; then the orb asks for one.
  const talk = params.get("talk") === "1";
  useEffect(() => {
    if (!talk || on) return;
    start();
    const t = setTimeout(() => setBlocked(true), 2500);
    return () => clearTimeout(t);
  }, [talk, on, start]);

  // Activity keeps it awake; half an hour of silence ends the session and lets the screen sleep.
  useEffect(() => {
    lastActive.current = Date.now();
  }, [last, state]);
  useEffect(() => {
    const t = setInterval(() => {
      if (Date.now() - lastActive.current < IDLE_MS) return;
      stop();
      void lock.current?.release();
    }, 60_000);
    return () => clearInterval(t);
  }, [stop]);

  // The orb breathes with the voice level.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (orb.current) orb.current.style.transform = `scale(${1 + Math.min(0.35, voice.level() * 0.5)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [voice]);

  useVoiceActions({
    focus_exit: {
      description: "Kitchen / focus mode: leave it (go back to the app; the screen can sleep again).",
      run: () => {
        router.push("/");
        return { left: true };
      },
    },
  });

  const label = { off: "Tap to talk", connecting: "Connecting…", listening: "Listening", thinking: "Thinking…", speaking: "Speaking" }[state];

  return (
    <div className="fixed inset-0 z-[55] flex flex-col items-center justify-between bg-bg px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-fg">
      <div className="flex w-full items-center justify-between font-mono text-[11px] uppercase tracking-wider text-faint">
        <span className="flex items-center gap-1.5">
          <Sun size={13} className={awake === "on" ? "text-core" : ""} />
          {awake === "on" ? "Screen stays on" : awake === "unsupported" ? "This browser can't keep the screen on" : "Screen may sleep"}
        </span>
        <button type="button" onClick={() => router.push("/")} aria-label="Leave kitchen mode" className="text-soft hover:text-fg">
          <X size={20} />
        </button>
      </div>

      <div className="flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-10">
        <button
          type="button"
          onClick={() => {
            setBlocked(false);
            if (on) stop();
            else start();
          }}
          aria-label={on ? "Stop listening" : "Start listening"}
          className="relative flex size-48 items-center justify-center sm:size-60"
        >
          <div
            ref={orb}
            className={cx(
              "absolute inset-0 rounded-full transition-colors duration-500",
              state === "speaking" ? "bg-core/30 shadow-[0_0_120px_20px] shadow-core/30" : state === "listening" ? "bg-ok/20 shadow-[0_0_100px_10px] shadow-ok/20" : state === "thinking" || state === "connecting" ? "bg-data/20 motion-safe:animate-pulse" : "bg-raised",
            )}
          />
          {on ? <Mic size={56} className="relative text-fg" /> : <MicOff size={56} className="relative text-soft" />}
        </button>
        <div className="font-mono text-sm uppercase tracking-[0.25em] text-soft">{blocked && !on ? "Tap the orb to start" : label}</div>

        {last && (
          <div className="w-full space-y-4 text-center">
            {last.q && <p className="text-lg text-soft sm:text-xl">{last.q}</p>}
            {last.a && <p className="max-h-[30vh] overflow-y-auto text-2xl leading-snug sm:text-3xl">{last.a}</p>}
          </div>
        )}
      </div>

      <p className="text-center text-xs text-faint">Say &quot;exit kitchen mode&quot; or tap ✕ to leave. It goes to sleep after 30 minutes of quiet.</p>
    </div>
  );
}

"use client";

import { Loader2, Mic, PhoneOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { toWav } from "@/lib/wav";

type Reply = { id?: string; text: string; audio: string | null; mime: string | null; done?: boolean; heard?: string };
type Line = { who: "hivemind" | "caller"; text: string };

/**
 * The caller's side of call screening: HIVEMIND's greeting plays, the caller answers, and it listens
 * until they stop talking (no buttons needed), a few times, then thanks them. Uses the call's mic.
 */
export function Screener({ room, name, owner, mic, onFinished }: { room: string; name: string; owner: string; mic: MediaStream; onFinished: () => void }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [phase, setPhase] = useState<"thinking" | "speaking" | "listening" | "done" | "error">("thinking");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const stopNow = useRef<(() => void) | null>(null);
  const finished = useRef(false);
  const idRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const post = async (body: Record<string, unknown>) => {
      const r = await fetch("/api/call/screen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room, ...body }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "The line dropped.");
      return j as Reply;
    };

    const speak = (r: Reply) =>
      new Promise<void>((resolve) => {
        if (!alive) return resolve();
        setPhase("speaking");
        setLines((l) => [...l, { who: "hivemind", text: r.text }]);
        if (r.audio) {
          const a = new Audio(`data:${r.mime || "audio/wav"};base64,${r.audio}`);
          a.onended = a.onerror = () => resolve();
          void a.play().catch(() => resolve());
        } else if ("speechSynthesis" in window) {
          const u = new SpeechSynthesisUtterance(r.text);
          u.onend = u.onerror = () => resolve();
          speechSynthesis.speak(u);
        } else resolve();
      });

    // Records until the caller has talked and then gone quiet for a moment (or 25 s).
    const listen = () =>
      new Promise<Blob>((resolve) => {
        setPhase("listening");
        const rec = new MediaRecorder(mic);
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType }));
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AC();
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        ctx.createMediaStreamSource(mic).connect(an);
        const buf = new Float32Array(an.fftSize);
        const started = Date.now();
        let floor = 0.01;
        let spoke = 0;
        let quietSince = 0;
        const stop = () => {
          clearInterval(t);
          void ctx.close();
          if (rec.state !== "inactive") rec.stop();
        };
        stopNow.current = stop;
        const t = setInterval(() => {
          an.getFloatTimeDomainData(buf);
          const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
          setLevel(Math.min(1, rms * 12));
          const age = Date.now() - started;
          if (age < 400) floor = Math.max(floor, rms);
          const talking = rms > Math.max(0.025, floor * 2.5);
          if (talking) {
            spoke += 100;
            quietSince = 0;
          } else if (!quietSince) quietSince = Date.now();
          const quiet = quietSince ? Date.now() - quietSince : 0;
          if ((spoke >= 500 && quiet >= 1500) || age >= 25_000 || (spoke < 300 && age >= 10_000)) stop();
        }, 100);
        rec.start(250);
      });

    (async () => {
      try {
        const first = await post({ op: "start", name });
        idRef.current = first.id ?? null;
        await speak(first);
        for (let turn = 0; alive && turn < 4; turn++) {
          const blob = await listen();
          if (!alive) return;
          setPhase("thinking");
          const { wav } = await toWav(blob, 16000);
          const r = await post({ op: "turn", id: idRef.current, audio: wav });
          if (r.heard) setLines((l) => [...l, { who: "caller", text: r.heard! }]);
          await speak(r);
          if (r.done) break;
        }
        finished.current = true;
        if (alive) {
          setPhase("done");
          onFinished();
        }
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    })();

    return () => {
      alive = false;
      stopNow.current?.();
      window.speechSynthesis?.cancel();
    };
    // Runs once per screening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Closing the page mid-call still tells the owner who called.
  useEffect(() => {
    const gone = () => {
      if (idRef.current && !finished.current) {
        finished.current = true;
        navigator.sendBeacon?.("/api/call/screen", new Blob([JSON.stringify({ room, op: "end", id: idRef.current })], { type: "application/json" }));
      }
    };
    window.addEventListener("pagehide", gone);
    return () => window.removeEventListener("pagehide", gone);
  }, [room]);

  // Hanging up early still tells the owner who called.
  function hangUp() {
    if (idRef.current && !finished.current) {
      void fetch("/api/call/screen", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room, op: "end", id: idRef.current }) });
    }
    finished.current = true;
    stopNow.current?.();
    onFinished();
  }

  const status = { thinking: "…", speaking: `${owner}'s assistant is speaking`, listening: "Listening… just talk", done: `Message passed on to ${owner}.`, error }[phase];

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      <div className="max-h-56 w-full space-y-2 overflow-y-auto text-sm">
        {lines.map((l, i) => (
          <p key={i} className={cx("rounded-xl px-3 py-2", l.who === "hivemind" ? "mr-8 bg-panel text-fg" : "ml-8 bg-data/15 text-right text-fg")}>
            {l.text}
          </p>
        ))}
      </div>
      <div className={cx("flex items-center gap-2 font-mono text-xs", phase === "error" ? "text-alert" : "text-soft")}>
        {phase === "thinking" && <Loader2 size={14} className="animate-spin" />}
        {phase === "listening" && <Mic size={14} className="text-ok" style={{ transform: `scale(${1 + level * 0.6})` }} />}
        {status}
      </div>
      {phase !== "done" && phase !== "error" && (
        <button type="button" onClick={hangUp} aria-label="Hang up" className="flex size-14 items-center justify-center rounded-full bg-alert text-white">
          <PhoneOff size={22} />
        </button>
      )}
    </div>
  );
}

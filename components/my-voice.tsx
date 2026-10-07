"use client";

import { Check, Loader2, Mic, Play, RotateCcw, Square, Trash2, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, cx, ErrorText } from "@/components/ui";
import { toWav } from "@/lib/wav";
import { api, useFetch } from "@/lib/client-api";

/**
 * Settings card: clone the owner's voice (a 10-30 s sample + Google's consent sentence), then switch
 * "Speak in my voice" on or off. Recording is converted here to the 24 kHz mono 16-bit WAV Google wants.
 */
type Status = { exists: boolean; enabled: boolean; created_at: string | null; consent_text: string };

// English, Tamil and Tanglish in one go, so the clone learns how the owner sounds in all three.
const SCRIPT =
  "Hi, I'm Karthikeyan. நான் சென்னையில் AI engineer-ஆ வேலை பார்க்கிறேன். Daily naan pudhu projects build pannuven, music kepen, and I love learning new things. இன்னைக்கு ஒரு நல்ல நாள், so let's get things done together!";
const TEST_LINE = "Hi Karthik! இது உங்க சொந்த குரல். Naalaiku plan ellam ready, don't worry.";

type Take = { wav: string; url: string; seconds: number };

function Recorder({ label, text, min, max, take, onTake }: { label: string; text: string; min: number; max: number; take: Take | null; onTake: (t: Take | null) => void }) {
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    rec.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  async function start() {
    setError(null);
    onTake(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true } });
      const chunks: Blob[] = [];
      const r = new MediaRecorder(stream);
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timer.current) clearInterval(timer.current);
        setRecording(false);
        try {
          const t = await toWav(new Blob(chunks, { type: r.mimeType }));
          if (t.seconds < min) setError(`That was ${t.seconds.toFixed(0)} s. Please record at least ${min} s.`);
          else onTake(t);
        } catch {
          setError("Couldn't read the recording. Try again.");
        }
      };
      rec.current = r;
      r.start();
      setRecording(true);
      setSecs(0);
      const began = Date.now();
      timer.current = setInterval(() => {
        const s = (Date.now() - began) / 1000;
        setSecs(s);
        if (s >= max) r.stop(); // Google takes 10-30 s
      }, 200);
    } catch {
      setError("Microphone permission is blocked for this site.");
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-line bg-raised/40 p-3">
      <div className="text-xs font-medium text-soft">{label}</div>
      <p className="rounded-md bg-sunken p-3 text-[15px] leading-relaxed">{text}</p>
      <div className="flex flex-wrap items-center gap-2">
        {recording ? (
          <Button size="sm" variant="danger" onClick={() => rec.current?.stop()}>
            <Square size={12} /> Stop · {secs.toFixed(0)} s
          </Button>
        ) : (
          <Button size="sm" variant={take ? "ghost" : "primary"} onClick={start}>
            {take ? <RotateCcw size={12} /> : <Mic size={13} />} {take ? "Record again" : "Record"}
          </Button>
        )}
        {recording && <span className="h-2 w-2 animate-pulse rounded-full bg-alert" />}
        {take && !recording && (
          <>
            <audio src={take.url} controls className="h-8 max-w-[14rem]" />
            <span className="flex items-center gap-1 text-xs text-ok">
              <Check size={12} /> {take.seconds.toFixed(0)} s
            </span>
          </>
        )}
      </div>
      <ErrorText error={error} />
    </div>
  );
}

export function MyVoiceCard() {
  const status = useFetch<Status>("/api/voice/mine");
  const [sample, setSample] = useState<Take | null>(null);
  const [consent, setConsent] = useState<Take | null>(null);
  const [busy, setBusy] = useState<"create" | "test" | "toggle" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);
  const s = status.data;

  async function create() {
    if (!sample || !consent) return;
    setBusy("create");
    setError(null);
    try {
      await api("/api/voice/mine", { method: "POST", json: { sample: sample.wav, consent: consent.wav } });
      setSetup(false);
      setSample(null);
      setConsent(null);
      await status.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function toggle(enabled: boolean) {
    setBusy("toggle");
    setError(null);
    try {
      await api("/api/voice/mine", { method: "PATCH", json: { enabled } });
      await status.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setError(null);
    try {
      const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: TEST_LINE }) });
      if (!r.ok) throw new Error(r.status === 429 ? "Google's free voice limit is reached for now. Try again later." : "Couldn't play the voice.");
      const audio = new Audio(URL.createObjectURL(await r.blob()));
      await audio.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm("Delete your cloned voice? HIVEMIND goes back to its usual voice. You can record it again any time.")) return;
    setBusy("delete");
    try {
      await api("/api/voice/mine", { method: "DELETE" });
      await status.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="font-semibold">My voice</h2>
        {s?.exists && <span className={cx("rounded px-1.5 py-0.5 font-mono text-[10px]", s.enabled ? "bg-ok/10 text-ok" : "bg-sunken text-soft")}>{s.enabled ? "ON" : "OFF"}</span>}
      </div>
      <p className="mb-3 text-sm text-soft">
        HIVEMIND can talk in your own voice, in English, Tamil and Tanglish. In live voice it starts about a second later than the usual voice. Your recordings go only to Google to make the voice; you can delete it any time.
      </p>

      {!status.data && status.loading ? (
        <p className="text-sm text-soft">Loading…</p>
      ) : s?.exists && !setup ? (
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={s.enabled} disabled={busy === "toggle"} onChange={(e) => toggle(e.target.checked)} className="h-4 w-4" />
            <span>
              <span className="font-medium">Speak in my voice</span>
              <span className="block text-xs text-soft">On: chat replies and live voice use your voice. Off: HIVEMIND&apos;s usual voice.</span>
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={test} disabled={!s.enabled || busy === "test"}>
              {busy === "test" ? <Loader2 size={12} className="animate-spin" /> : <Volume2 size={13} />} Hear it
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setSetup(true)}>
              <RotateCcw size={12} /> Record again
            </Button>
            <Button size="sm" variant="danger" onClick={remove} disabled={busy === "delete"}>
              <Trash2 size={12} /> Delete my voice
            </Button>
          </div>
          {s.created_at && <p className="text-xs text-faint">Created {new Date(s.created_at).toLocaleDateString()}</p>}
        </div>
      ) : !setup ? (
        <Button onClick={() => setSetup(true)}>
          <Mic size={14} /> Set up my voice
        </Button>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-soft">Somewhere quiet, phone or laptop mic close to you. Speak naturally, like you talk to a friend.</p>
          <Recorder label="1 · Read this aloud (10-30 seconds)" text={SCRIPT} min={10} max={30} take={sample} onTake={setSample} />
          <Recorder label="2 · Google's consent sentence: read it exactly, word for word" text={s?.consent_text ?? ""} min={3} max={20} take={consent} onTake={setConsent} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={create} disabled={!sample || !consent || busy === "create"}>
              {busy === "create" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} {busy === "create" ? "Creating your voice…" : "Create my voice"}
            </Button>
            <Button variant="quiet" onClick={() => setSetup(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <ErrorText error={error ?? status.error} />
    </section>
  );
}

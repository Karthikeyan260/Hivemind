"use client";

import { Ear, Mic, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, cx, ErrorText, Input } from "@/components/ui";
import { sfx } from "@/lib/sfx";
import { recordFeatures, startDetector, type Detector } from "@/lib/wake/detector";
import { loadWakeFeatures } from "@/lib/wake/features";
import { calibrate, threshold, trim, type Seq } from "@/lib/wake/match";
import { loadWake, packSeq, saveWake, WAKE_CHANGED, type WakeModel } from "@/lib/wake/store";

const TAKES = 8;
const SENTENCE = "I was planning to cook something simple tonight, maybe dosa, and then watch a movie with my family.";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Settings: teach HIVEMIND a wake word in the owner's own voice (any word, any language), test it,
 * and set how eager it is. Everything stays on this device.
 */
export function WakeWordCard() {
  const [model, setModel] = useState<WakeModel | null>(null);
  const [word, setWord] = useState("Hey Karthik");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [testing, setTesting] = useState(false);
  const [heard, setHeard] = useState(0);
  const [last, setLast] = useState<{ s: number; thr: number } | null>(null);
  const det = useRef<Detector | null>(null);

  useEffect(() => {
    const load = () => {
      const m = loadWake();
      setModel(m);
      if (m) setWord(m.word);
    };
    load();
    window.addEventListener(WAKE_CHANGED, load);
    return () => window.removeEventListener(WAKE_CHANGED, load);
  }, []);

  // Stop the test listener when leaving the page or when the word changes.
  useEffect(() => {
    if (!testing || !model) return;
    let cancelled = false;
    startDetector(
      model,
      () => {
        sfx.done();
        setHeard((n) => n + 1);
      },
      (s, thr) => setLast({ s, thr }),
    )
      .then((d) => (cancelled ? d.stop() : (det.current = d)))
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setTesting(false);
      });
    return () => {
      cancelled = true;
      det.current?.stop();
      det.current = null;
    };
  }, [testing, model]);

  async function enroll() {
    const w = word.trim().slice(0, 40);
    if (!w) return setError("Type your wake word first.");
    setTesting(false);
    setBusy(true);
    setError(null);
    try {
      setStatus("Loading the speech model (first time only)…");
      await loadWakeFeatures();
      const templates: Seq[] = [];
      const full: Seq[] = [];
      let tries = 0;
      while (templates.length < TAKES) {
        if (++tries > TAKES + 6) throw new Error("Too many takes weren't heard. Try a quieter spot, a bit closer to the mic.");
        setStatus(`Get ready… (${templates.length + 1} of ${TAKES})`);
        sfx.lock();
        await sleep(450);
        setStatus(`Say “${w}” now (${templates.length + 1} of ${TAKES})`);
        const { seq, rms } = await recordFeatures(2.2, setLevel);
        setLevel(0);
        const t = trim(seq, rms);
        if (!t) {
          setStatus("Didn't catch that. Once more, a little louder.");
          await sleep(1100);
          continue;
        }
        templates.push(t);
        full.push(seq);
        await sleep(300);
      }
      setStatus(`Last step: read this out in your normal voice. “${SENTENCE}”`);
      await sleep(2500);
      sfx.lock();
      const bg = await recordFeatures(7, setLevel);
      setLevel(0);
      const { pos, neg } = calibrate(templates, full, bg.seq);
      const m: WakeModel = { word: w, templates: templates.map(packSeq), pos, neg, sensitivity: model?.sensitivity ?? 0.5, enabled: true, at: new Date().toISOString() };
      saveWake(m);
      setStatus(
        threshold(pos, neg, 0.5) > neg * 0.8
          ? `Saved, but “${w}” sounds a lot like ordinary speech, so it may wake by mistake. A longer or more unusual word works better.`
          : `Saved. Tap Test and say “${w}”.`,
      );
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLevel(0);
      setBusy(false);
    }
  }

  function update(patch: Partial<WakeModel>) {
    if (!model) return;
    saveWake({ ...model, ...patch });
  }

  function remove() {
    if (!confirm("Forget your wake word on this device?")) return;
    setTesting(false);
    saveWake(null);
    setStatus(null);
  }

  const thr = model ? threshold(model.pos, model.neg, model.sensitivity) : 0;

  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <h2 className="mb-2 flex items-center gap-2 font-semibold">
        <Ear size={16} className="text-data" /> Wake word
      </h2>
      <p className="mb-3 text-sm text-soft">
        Say your own word to start talking, hands-free, while HIVEMIND is open. Pick any word or name in any language (2–4 syllables, like “Hey Karthik” or
        “Vanakkam Jarvis”), then say it {TAKES} times. It&apos;s learned and heard on this device only: no audio leaves it until the conversation starts.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input value={word} onChange={(e) => setWord(e.target.value)} placeholder="Your wake word" maxLength={40} disabled={busy} className="max-w-56" />
        <Button size="sm" onClick={enroll} disabled={busy}>
          <Mic size={13} /> {model ? "Record again" : "Teach it"}
        </Button>
      </div>

      {busy && (
        <div className="mb-3 h-1.5 w-full max-w-sm overflow-hidden rounded bg-sunken" aria-hidden>
          <div className="h-full bg-core transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
      )}
      {status && (
        <p className="mb-3 text-sm" role="status" aria-live="polite">
          {status}
        </p>
      )}
      <ErrorText error={error} />

      {model && !busy && (
        <div className="space-y-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={model.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
            Listen for “{model.word}” on this device
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-soft">Sensitivity</span>
            <span className="text-xs text-soft">strict</span>
            <input type="range" min={0} max={1} step={0.1} value={model.sensitivity} onChange={(e) => update({ sensitivity: Number(e.target.value) })} className="w-40" aria-label="Sensitivity" />
            <span className="text-xs text-soft">eager</span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={testing ? "primary" : "ghost"} onClick={() => setTesting((t) => !t)}>
              <Ear size={13} /> {testing ? "Stop test" : "Test"}
            </Button>
            <Button size="sm" variant="danger" onClick={remove}>
              <Trash2 size={13} /> Forget
            </Button>
            {testing && (
              <span className="font-mono text-xs text-soft">
                {heard ? <b className="font-normal text-core">heard it ×{heard}</b> : "listening…"}
                {last && (
                  <span className={cx("ml-2", last.s < last.thr ? "text-core" : "text-soft")}>
                    match {Math.max(0, Math.round((1 - last.s / (thr * 2)) * 100))}%
                  </span>
                )}
              </span>
            )}
          </div>
          <p className="text-xs text-soft">
            Works while the app is open on screen (phones don&apos;t let web apps listen in the background). If it wakes by mistake, lower the sensitivity; if it
            misses you, raise it or record again where you usually use it.
          </p>
        </div>
      )}
    </section>
  );
}

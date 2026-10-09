"use client";

import { Fingerprint, Mic, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, cx, ErrorText } from "@/components/ui";
import { cosine } from "@/lib/voiceprint/fbank";
import { loadSpeakerModel } from "@/lib/voiceprint/model";
import { enrolQuality, THRESHOLD, type Strictness } from "@/lib/voiceprint/policy";
import { recordSamples } from "@/lib/voiceprint/record";
import { loadVoiceprint, saveVoiceprint, VOICEPRINT_CHANGED, type Voiceprint } from "@/lib/voiceprint/store";

const LINES = [
  "Hey HIVEMIND, this is my voice. Remember what I tell you and keep my notes safe.",
  "Naan dhaan pesaren. Indha voice-a vechu ennai kandupidi, sariya?",
  "Delete, send, call or save: only when I'm the one asking. Guests can just chat.",
];
const SECONDS = 5;

/**
 * Settings: the owner's voiceprint. With it, risky voice actions (deleting, sending, calling,
 * approving, ending guest mode, saving after a guest) only go through when it's the owner speaking.
 */
export function VoiceprintCard() {
  const [vp, setVp] = useState<Voiceprint | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ score: number; pass: boolean } | null>(null);

  useEffect(() => {
    const load = () => setVp(loadVoiceprint());
    load();
    window.addEventListener(VOICEPRINT_CHANGED, load);
    return () => window.removeEventListener(VOICEPRINT_CHANGED, load);
  }, []);

  async function enrol() {
    setBusy(true);
    setError(null);
    setTest(null);
    try {
      setStep("Loading the voice model (about 30 MB, first time only)…");
      const model = await loadSpeakerModel();
      const prints: Float32Array[] = [];
      for (let i = 0; i < LINES.length; i++) {
        setStep(`Read this out (${i + 1} of ${LINES.length}): “${LINES[i]}”`);
        const e = await model.embed(await recordSamples(SECONDS, setLevel));
        setLevel(0);
        if (!e) throw new Error("I couldn't hear enough speech. Try again a little closer to the mic, in a quiet spot.");
        prints.push(e);
      }
      const centre = new Float32Array(prints[0].length);
      for (const p of prints) for (let k = 0; k < centre.length; k++) centre[k] += p[k] / prints.length;
      const quality = enrolQuality(prints.map((p) => cosine(p, centre)));
      const next: Voiceprint = { print: Array.from(centre, (x) => Math.round(x * 1e5) / 1e5), strictness: vp?.strictness ?? "normal", enabled: true, at: new Date().toISOString(), quality };
      saveVoiceprint(next);
      setStep(quality === "poor" ? "Saved, but the recordings didn't agree well (noise or another voice?). Record again in a quiet spot for better results." : "Saved. Tap Test and say anything.");
    } catch (e) {
      setStep(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLevel(0);
      setBusy(false);
    }
  }

  async function check() {
    if (!vp) return;
    setBusy(true);
    setError(null);
    try {
      setStep("Say anything for 3 seconds…");
      const model = await loadSpeakerModel();
      const e = await model.embed(await recordSamples(3, setLevel));
      if (!e) throw new Error("Didn't hear enough. Speak a bit longer.");
      const score = cosine(e, vp.print);
      setTest({ score, pass: score >= THRESHOLD[vp.strictness] });
      setStep(null);
    } catch (e) {
      setStep(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLevel(0);
      setBusy(false);
    }
  }

  const update = (patch: Partial<Voiceprint>) => vp && saveVoiceprint({ ...vp, ...patch });

  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <h2 className="mb-2 flex items-center gap-2 font-semibold">
        <Fingerprint size={16} className="text-data" /> Voiceprint
      </h2>
      <p className="mb-3 text-sm text-soft">
        HIVEMIND learns what your voice sounds like, so only you can delete, send, call, approve, end guest mode, or save things after a guest has talked. Anyone can
        still chat. If it isn&apos;t sure, it asks on screen. The voiceprint stays on this device (512 numbers, no recording).
      </p>

      <Button size="sm" onClick={enrol} disabled={busy}>
        <Mic size={13} /> {vp ? "Record again" : "Set up my voiceprint"}
      </Button>

      {busy && (
        <div className="mt-3 h-1.5 w-full max-w-sm overflow-hidden rounded bg-sunken" aria-hidden>
          <div className="h-full bg-core transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
      )}
      {step && (
        <p className="mt-3 text-sm" role="status" aria-live="polite">
          {step}
        </p>
      )}
      <div className="mt-3">
        <ErrorText error={error} />
      </div>

      {vp && !busy && (
        <div className="mt-3 space-y-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={vp.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
            Check my voice for risky actions on this device
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-soft">Strictness</span>
            {(["relaxed", "normal", "strict"] as Strictness[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => update({ strictness: s })}
                className={cx("border px-2.5 py-1 text-xs capitalize", vp.strictness === s ? "border-core text-core" : "border-line text-soft hover:text-fg")}
              >
                {s}
              </button>
            ))}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={check}>
              Test
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                if (confirm("Forget your voiceprint on this device?")) saveVoiceprint(null);
              }}
            >
              <Trash2 size={13} /> Forget
            </Button>
            {test && (
              <span className={cx("font-mono text-xs", test.pass ? "text-ok" : "text-alert")}>
                {test.pass ? "✓ that's you" : "✗ not recognised"} · match {Math.round(test.score * 100)}% (needs {Math.round(THRESHOLD[vp.strictness] * 100)}%)
              </span>
            )}
          </div>
          <p className="text-xs text-soft">
            Recorded {new Date(vp.at).toLocaleDateString()} · quality {vp.quality}. A cold or a very different mic can lower the match: record again if it starts missing
            you. Ask a friend to try Test: they should not pass.
          </p>
        </div>
      )}
    </section>
  );
}

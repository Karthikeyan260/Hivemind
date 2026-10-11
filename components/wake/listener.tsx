"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useVoice } from "@/components/voice/provider";
import { isPublicPage } from "@/lib/public-paths";
import { sfx } from "@/lib/sfx";
import { startDetector } from "@/lib/wake/detector";
import { cosine } from "@/lib/voiceprint/fbank";
import { loadSpeakerModel } from "@/lib/voiceprint/model";
import { THRESHOLD } from "@/lib/voiceprint/policy";
import { loadVoiceprint, type Voiceprint } from "@/lib/voiceprint/store";
import { loadWake, WAKE_CHANGED, WAKE_REJECTED, wakeOnThisTab, type WakeModel } from "@/lib/wake/store";

/** Was the wake word said by the owner? A wake word is short, so a little less speech is accepted. */
async function isOwner(heard: Float32Array, vp: Voiceprint) {
  const model = await loadSpeakerModel();
  const e = await model.embed(heard, 0.5);
  return !!e && cosine(e, vp.print) >= THRESHOLD[vp.strictness] - 0.05;
}

/** While the app is open and voice is off, listens on this device for the owner's wake word. */
export function WakeListener() {
  const voice = useVoice();
  const pathname = usePathname();
  const [model, setModel] = useState<WakeModel | null>(null);
  const [visible, setVisible] = useState(true);
  const [tabOn, setTabOn] = useState(false);

  useEffect(() => {
    const load = () => {
      setModel(loadWake());
      setTabOn(wakeOnThisTab());
    };
    const vis = () => setVisible(!document.hidden);
    load();
    vis();
    window.addEventListener(WAKE_CHANGED, load);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener(WAKE_CHANGED, load);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  // The settings page runs its own test listener; voice uses the mic itself.
  // Only when switched on (the ear button, or "start listening when I open HIVEMIND"): never by surprise.
  const active = !!model?.enabled && (!!model.autoStart || tabOn) && visible && voice.state === "off" && !isPublicPage(pathname) && !pathname.startsWith("/settings");
  const start = voice.start;

  useEffect(() => {
    if (!active || !model) return;
    let det: { stop: () => void } | null = null;
    let cancelled = false;
    // With a voiceprint, only the owner saying the word starts voice (not a guest, not the TV).
    const vp = loadVoiceprint();
    const checkVoice = vp?.enabled;
    if (checkVoice) void loadSpeakerModel().catch(() => {}); // ready before the word is said
    startDetector(model, async (heard) => {
      if (checkVoice) {
        const ok = await isOwner(heard, vp!).catch(() => false);
        if (!ok) {
          window.dispatchEvent(new Event(WAKE_REJECTED));
          return;
        }
      }
      sfx.lock();
      start();
    })
      .then((d) => (cancelled ? d.stop() : (det = d)))
      .catch((e) => console.warn("wake word:", e instanceof Error ? e.message : e));
    return () => {
      cancelled = true;
      det?.stop();
    };
  }, [active, model, start]);

  return null;
}

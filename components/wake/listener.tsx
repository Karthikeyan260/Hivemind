"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useVoice } from "@/components/voice/provider";
import { isPublicPage } from "@/lib/public-paths";
import { sfx } from "@/lib/sfx";
import { startDetector } from "@/lib/wake/detector";
import { loadWake, WAKE_CHANGED, type WakeModel } from "@/lib/wake/store";

/** While the app is open and voice is off, listens on this device for the owner's wake word. */
export function WakeListener() {
  const voice = useVoice();
  const pathname = usePathname();
  const [model, setModel] = useState<WakeModel | null>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const load = () => setModel(loadWake());
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
  const active = !!model?.enabled && visible && voice.state === "off" && !isPublicPage(pathname) && !pathname.startsWith("/settings");
  const start = voice.start;

  useEffect(() => {
    if (!active || !model) return;
    let det: { stop: () => void } | null = null;
    let cancelled = false;
    startDetector(model, () => {
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

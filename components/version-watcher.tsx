"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useVoice } from "@/components/voice/provider";
import { isPublicPage } from "@/lib/public-paths";

/**
 * Phones keep an installed app's page in memory, so reopening HIVEMIND can show the old version
 * for days after an update. When the app comes back to the front (and every few minutes), this asks
 * the server which build it runs; if it's newer, the page reloads, but never during a voice chat,
 * a game, a call, or while something is being typed.
 */
const MINE = process.env.NEXT_PUBLIC_BUILD ?? "";

export function VersionWatcher() {
  const voice = useVoice();
  const path = usePathname();
  const safe = useRef(true);
  useEffect(() => {
    const typing = () => {
      const el = document.activeElement as HTMLInputElement | null;
      return !!el && ["INPUT", "TEXTAREA"].includes(el.tagName) && !!el.value;
    };
    safe.current = voice.state === "off" && !path.startsWith("/games") && !isPublicPage(path) && !path.startsWith("/focus");
    let busy = false;
    const check = async () => {
      if (busy || document.hidden || !MINE) return;
      busy = true;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const { build } = (await r.json()) as { build: string };
        if (build && build !== MINE && safe.current && !typing()) location.reload();
      } catch {
        // offline: try again next time
      } finally {
        busy = false;
      }
    };
    void check();
    const t = setInterval(check, 5 * 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", check);
    };
  }, [voice.state, path]);
  return null;
}

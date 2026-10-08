"use client";

import { useEffect, useState } from "react";
import { BRAIN_CHANGED } from "@/lib/client-api";

export type NavApp = { id: string; name: string; emoji: string };

// One fetch shared by every menu on the page (the sidebar and the phone menu both show the apps).
let cache: NavApp[] = [];
let inflight: Promise<NavApp[]> | null = null;
const listeners = new Set<(a: NavApp[]) => void>();

function refresh() {
  inflight ??= fetch("/api/apps")
    .then((r) => (r.ok ? r.json() : { apps: [] }))
    .then((d: { apps: (NavApp & { status: string })[] }) => (cache = d.apps.filter((a) => a.status !== "failed" && a.name !== "New app").slice(0, 8)))
    .catch(() => cache)
    .finally(() => {
      inflight = null;
      for (const l of listeners) l(cache);
    });
  return inflight;
}

/** The owner's ready apps, for the menu (refreshes when an app is built, changed or deleted). */
export function useMyApps() {
  const [apps, setApps] = useState<NavApp[]>(cache);
  useEffect(() => {
    listeners.add(setApps);
    if (listeners.size === 1) {
      void refresh();
      window.addEventListener(BRAIN_CHANGED, refresh);
    }
    return () => {
      listeners.delete(setApps);
      if (!listeners.size) window.removeEventListener(BRAIN_CHANGED, refresh);
    };
  }, []);
  return apps;
}

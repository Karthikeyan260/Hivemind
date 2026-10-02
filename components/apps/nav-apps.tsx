"use client";

import { useEffect, useState } from "react";
import { BRAIN_CHANGED } from "@/lib/client-api";

export type NavApp = { id: string; name: string; emoji: string };

/** The owner's ready apps, for the menu (refreshes when an app is built, changed or deleted). */
export function useMyApps() {
  const [apps, setApps] = useState<NavApp[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/apps")
        .then((r) => (r.ok ? r.json() : { apps: [] }))
        .then((d: { apps: (NavApp & { status: string })[] }) => alive && setApps(d.apps.filter((a) => a.status !== "failed" && a.name !== "New app").slice(0, 8)))
        .catch(() => {});
    void load();
    window.addEventListener(BRAIN_CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(BRAIN_CHANGED, load);
    };
  }, []);
  return apps;
}

"use client";

import { LogOut, MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { Button, ErrorText } from "@/components/ui";
import { timeAgo, useFetch } from "@/lib/client-api";
import { clearOfflineCache } from "@/lib/offline";

type S = { created: string; expires: string; device: string };

/** A rough device name from the browser's user agent ("Chrome on Android"). */
function describe(ua: string) {
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "a device";
  const app = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${app} on ${os}`;
}

/** Settings: the browsers signed in to HIVEMIND, and "log out everywhere" (e.g. a lost phone). */
export function SessionsCard() {
  const list = useFetch<{ sessions: S[] }>("/api/sessions");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function everywhere() {
    if (!confirm("Log out every device, including this one? You'll need the password again everywhere.")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/unlock?all=1", { method: "DELETE" });
      if (!r.ok && r.status !== 204) throw new Error("Couldn't log out the other devices.");
      await clearOfflineCache();
      // A full reload, so nothing from the signed-in app stays in memory.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate hard navigation
      location.assign("/unlock");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <h2 className="mb-2 font-semibold">Signed-in devices</h2>
      <p className="mb-3 text-sm text-soft">Each sign-in lasts 180 days, ends when you lock or log out, and every one ends when the password changes.</p>
      <ul className="mb-3 space-y-1.5 text-sm">
        {(list.data?.sessions ?? []).map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <MonitorSmartphone size={14} className="shrink-0 text-data" />
            <span className="min-w-0 flex-1 truncate">{describe(s.device)}</span>
            <span className="font-mono text-[11px] text-soft">since {timeAgo(s.created)}</span>
          </li>
        ))}
        {list.data && !list.data.sessions.length && <li className="text-soft">No sessions.</li>}
      </ul>
      <ErrorText error={error} />
      <Button variant="danger" size="sm" onClick={everywhere} disabled={busy}>
        <LogOut size={13} /> Log out all devices
      </Button>
    </section>
  );
}

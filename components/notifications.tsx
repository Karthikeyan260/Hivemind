"use client";

import { Bell, BellOff, BellRing } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { cx } from "@/components/ui";
import { startOfflineSync } from "@/lib/offline";
import { isPublicPage } from "@/lib/public-paths";

/** Production builds also cache the app for offline use; the dev server never does (stale chunks). */
const SW_URL = process.env.NODE_ENV === "production" ? "/sw.js?cache=1" : "/sw.js";

/** Registers the service worker (notifications while HIVEMIND is closed, offline pages) and offline sync. */
export function ServiceWorker() {
  const path = usePathname();
  useEffect(() => {
    if (isPublicPage(path)) return;
    startOfflineSync();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(SW_URL).catch(() => {});
  }, [path]);
  return null;
}

const toKey = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const deviceName = () => {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "Mac" : "Device";
  const app = matchMedia("(display-mode: standalone)").matches ? "app" : "browser";
  return `${os} ${app}`;
};

type State = "loading" | "unsupported" | "ios-install" | "unconfigured" | "denied" | "off" | "on";

/** Settings card: turn notifications on for this device, send a test, see subscribed devices. */
export function NotificationsCard() {
  const [state, setState] = useState<State>("loading");
  const [key, setKey] = useState<string | null>(null);
  const [devices, setDevices] = useState<{ endpoint: string; device?: string }[]>([]);
  const [mine, setMine] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const ios = /iPhone|iPad/i.test(navigator.userAgent);
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      // iPhone only allows web notifications for the app added to the home screen.
      setState(ios && !matchMedia("(display-mode: standalone)").matches ? "ios-install" : "unsupported");
      return;
    }
    const r = await fetch("/api/push").then((x) => x.json() as Promise<{ configured: boolean; publicKey: string | null; devices: { endpoint: string; device?: string }[]; schedulerLastRun: string | null }>);
    setLastRun(r.schedulerLastRun);
    setKey(r.publicKey);
    setDevices(r.devices);
    if (!r.configured) return setState("unconfigured");
    if (Notification.permission === "denied") return setState("denied");
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    setMine(sub?.endpoint ?? null);
    // Subscribed here but the server doesn't know this device (a failed save): register it again.
    if (sub && !r.devices.some((d) => d.endpoint === sub.endpoint)) {
      const ok = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), device: deviceName() }) }).then((x) => x.ok);
      if (ok) setDevices([...r.devices, { endpoint: sub.endpoint, device: deviceName() }]);
    }
    setState(sub ? "on" : "off");
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read this device's notification state once
    void refresh();
  }, [refresh]);

  async function enable() {
    setBusy(true);
    setMsg("");
    try {
      if ((await Notification.requestPermission()) !== "granted") return setState("denied");
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register(SW_URL));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(key!) });
      const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), device: deviceName() }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Couldn't save this device.");
      await test();
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Couldn't turn on notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setBusy(false);
    setMsg("");
    await refresh();
  }

  async function test() {
    const r = await fetch("/api/push/test", { method: "POST" }).then((x) => x.json() as Promise<{ sent?: number }>);
    setMsg(r.sent ? `Test sent to ${r.sent} device${r.sent > 1 ? "s" : ""}.` : "No device received it. Try turning notifications off and on again.");
  }

  const note: Record<State, string> = {
    loading: "Checking this device…",
    unsupported: "This browser can't show notifications. Use Chrome on Android, or the installed app on iPhone.",
    "ios-install": "On iPhone, first add HIVEMIND to your Home Screen (Share → Add to Home Screen), open it from there, then come back here.",
    unconfigured: "Notifications aren't set up on the server yet: add the VAPID keys to the environment.",
    denied: "Notifications are blocked for this site. Allow them in your browser/phone settings, then reload.",
    off: "Get reminders, a morning brief and incoming HIVEMIND calls even when the app is closed.",
    on: "On for this device. You'll get reminders, the morning brief and incoming calls.",
  };

  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <h2 className="mb-2 flex items-center gap-2 font-semibold">
        {state === "on" ? <BellRing size={16} className="text-ok" /> : state === "denied" ? <BellOff size={16} className="text-alert" /> : <Bell size={16} />} Notifications
      </h2>
      <p className="text-sm text-soft">{note[state]}</p>
      {devices.length > 0 && (
        <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-faint">
          {devices.map((d) => (
            <li key={d.endpoint} className={d.endpoint === mine ? "text-ok" : ""}>
              • {d.device || "Device"}
              {d.endpoint === mine ? " (this device)" : ""}
            </li>
          ))}
        </ul>
      )}
      {state === "on" && (() => {
        // Closed-app notifications depend on cron-job.org calling /api/cron/notify every 5 minutes.
        const mins = lastRun ? Math.round((Date.now() - +new Date(lastRun)) / 60000) : null;
        const ok = mins != null && mins <= 15;
        return (
          <p className={cx("mt-2 font-mono text-[11px]", ok ? "text-faint" : "text-alert")}>
            {mins == null ? "Scheduler has never run: set up the cron-job.org job." : ok ? `Scheduler last checked ${mins < 1 ? "just now" : `${mins} min ago`}` : `Scheduler last ran ${mins} min ago: check your cron-job.org job.`}
          </p>
        );
      })()}
      <div className="mt-3 flex flex-wrap gap-2">
        {state === "off" && (
          <button type="button" onClick={enable} disabled={busy || !key} className="rounded-md bg-core px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50">
            {busy ? "Turning on…" : "Turn on for this device"}
          </button>
        )}
        {state === "on" && (
          <>
            <button type="button" onClick={test} className="rounded-md border border-line px-3 py-1.5 text-sm">
              Send a test
            </button>
            <button type="button" onClick={disable} disabled={busy} className="rounded-md border border-line px-3 py-1.5 text-sm text-soft">
              Turn off here
            </button>
          </>
        )}
      </div>
      {msg && <p className="mt-2 text-xs text-soft">{msg}</p>}
    </section>
  );
}

"use client";

import { MapPin, Smartphone } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cx, ErrorText } from "@/components/ui";
import { timeAgo, useFetch } from "@/lib/client-api";
import { deviceName, getFix, setSharing, sharing } from "@/lib/location";

type Device = { id: string; name: string; at: string; accuracy: number };

/** Settings: share this device's location with HIVEMIND (for "where's my phone"), and the devices that do. */
export function LocationCard() {
  const devices = useFetch<{ devices: Device[] }>("/api/location");
  const [on, setOn] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read this device's saved choice once
    setOn(sharing());
    setName(deviceName());
  }, []);

  async function toggle(next: boolean) {
    setError(null);
    const fix = await setSharing(next);
    if (next && !fix) {
      await setSharing(false);
      setError("Location is blocked for this site. Allow it in the browser (the lock icon by the address), then try again.");
      return;
    }
    setOn(next);
    void devices.reload();
  }

  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <h2 className="mb-1 font-semibold">Location</h2>
      <p className="mb-3 text-sm text-soft">
        For &quot;where am I&quot;, &quot;parks near me&quot; and directions, HIVEMIND asks this device where it is when you ask. With sharing on, it also keeps this device&apos;s last spot so you can ask &quot;where&apos;s my phone?&quot; from another device. Never tracked in the background.
      </p>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={on} onChange={(e) => void toggle(e.target.checked)} className="h-4 w-4" />
        <span>
          <span className="font-medium">Share this device&apos;s location</span>
          <span className="block text-xs text-soft">{name}</span>
        </span>
      </label>
      {(devices.data?.devices.length ?? 0) > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {devices.data!.devices.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <Smartphone size={13} className="text-soft" />
              <span className="flex-1">{d.name}</span>
              <span className={cx("font-mono text-[11px]", d.accuracy > 200 ? "text-faint" : "text-ok")}>{d.accuracy > 200 ? "approximate" : "precise"}</span>
              <span className="font-mono text-[11px] text-faint">{timeAgo(d.at)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-3 text-sm">
        <Link href="/map" className="flex items-center gap-1 text-data hover:underline">
          <MapPin size={13} /> Open the map
        </Link>
      </div>
      <ErrorText error={error} />
    </section>
  );
}

/** While the app is open and this device shares its location, keep its last spot fresh (every 5 min). */
export function LocationReporter() {
  useEffect(() => {
    const tick = () => {
      if (sharing() && document.visibilityState === "visible") void getFix(4 * 60_000);
    };
    tick();
    const t = setInterval(tick, 5 * 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  return null;
}

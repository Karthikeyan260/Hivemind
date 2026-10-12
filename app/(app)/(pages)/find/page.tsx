"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { BatteryCharging, BatteryLow, BatteryMedium, BellRing, Check, Copy, KeyRound, Loader2, MapPin, Navigation, Plus, ShieldAlert, Smartphone, Trash2, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, cx, ErrorText, Input, PageHeader } from "@/components/ui";
import { timeAgo } from "@/lib/client-api";

/**
 * Find my devices: where each device last checked in (sent by a small helper app on it, so it works
 * with HIVEMIND closed), ring it by notification or loudly through the helper app, lost mode, and
 * step-by-step setup for MacroDroid.
 */
type Ping = { lat: number; lng: number; acc?: number; battery?: number; charging?: boolean; event?: string; at: string };
type Device = { id: string; name: string; created: string; ringUrl?: string; pushEndpoint?: string; lost?: { since: string; message: string }; last?: Ping; trail: Ping[] };
type Browser = { endpoint: string; device: string; added?: string };

export default function FindPage() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [browsers, setBrowsers] = useState<Browser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ id: string; url: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/finder");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Couldn't load.");
      setDevices(j.devices);
      setBrowsers(j.browsers);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the list, then every 30 s
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function call(method: string, body: object, url = "/api/finder") {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
    return j;
  }
  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  // The map: each device's last place, and its recent trail when picked.
  const box = useRef<HTMLDivElement | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const Lref = useRef<typeof Leaflet | null>(null);
  const [mapReady, setMapReady] = useState(false);
  useEffect(() => {
    let off = false;
    void import("leaflet").then((mod) => {
      if (off || !box.current || map.current) return;
      Lref.current = mod;
      const m = mod.map(box.current, { zoomControl: true }).setView([13.0827, 80.2707], 12);
      mod.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
      layer.current = mod.layerGroup().addTo(m);
      map.current = m;
      setTimeout(() => m.invalidateSize(), 50);
      setMapReady(true);
    });
    return () => {
      off = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const L = Lref.current;
    const m = map.current;
    if (!mapReady || !L || !m || !layer.current || !devices) return;
    layer.current.clearLayers();
    const pts: [number, number][] = [];
    for (const d of devices) {
      if (!d.last) continue;
      const here: [number, number] = [d.last.lat, d.last.lng];
      pts.push(here);
      const color = d.lost ? "#ef4444" : "#facc15";
      if (focus === d.id && d.trail.length > 1) L.polyline(d.trail.map((p) => [p.lat, p.lng] as [number, number]), { color, weight: 3, opacity: 0.6, dashArray: "4 6" }).addTo(layer.current);
      if (d.last.acc && d.last.acc < 2000) L.circle(here, { radius: d.last.acc, color, weight: 1, fillOpacity: 0.08 }).addTo(layer.current);
      L.circleMarker(here, { radius: 9, color: "#111", weight: 2, fillColor: color, fillOpacity: 1 })
        .bindTooltip(`${d.name} · ${timeAgo(d.last.at)}`, { permanent: true, direction: "top", offset: [0, -10] })
        .addTo(layer.current);
    }
    const f = devices.find((d) => d.id === focus)?.last;
    if (f) m.setView([f.lat, f.lng], 16);
    else if (pts.length === 1) m.setView(pts[0], 15);
    else if (pts.length > 1) m.fitBounds(pts, { padding: [40, 40] });
  }, [devices, focus, mapReady]);

  const battery = (p: Ping) => {
    if (p.battery === undefined) return null;
    const Icon = p.charging ? BatteryCharging : p.battery <= 20 ? BatteryLow : BatteryMedium;
    return (
      <span className={cx("inline-flex items-center gap-0.5", p.battery <= 20 && !p.charging && "text-alert")}>
        <Icon size={13} /> {p.battery}%
      </span>
    );
  };

  return (
    <div className="mx-auto max-w-5xl pb-20">
      <PageHeader eyebrow="Devices" title="Find my devices" subtitle="Where each device last was (even with HIVEMIND closed), ring it, and lost mode." />
      <ErrorText error={error} />
      {notice && (
        <p className="mb-3 rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok" role="status">
          {notice}
        </p>
      )}

      <div ref={box} className="mb-4 h-72 w-full overflow-hidden rounded-xl border border-line sm:h-96" />

      <div className="grid gap-3 sm:grid-cols-2">
        {devices?.map((d) => (
          <div key={d.id} className={cx("rounded-xl border bg-panel p-3", d.lost ? "border-alert/60" : focus === d.id ? "border-core/60" : "border-line")}>
            <div className="flex items-start gap-2">
              <Smartphone size={18} className={d.lost ? "text-alert" : "text-data"} />
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => setFocus(focus === d.id ? null : d.id)} className="truncate text-left font-semibold hover:text-core">
                  {d.name}
                </button>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-soft">
                  {d.last ? (
                    <>
                      <span>{timeAgo(d.last.at)}</span>
                      {d.last.acc !== undefined && <span>±{d.last.acc} m</span>}
                      {battery(d.last)}
                      {d.last.event && <span>· {d.last.event}</span>}
                    </>
                  ) : (
                    <span className="text-core">Waiting for its first check-in (set up the helper app)</span>
                  )}
                </div>
                {d.lost && <div className="mt-1 text-xs font-semibold text-alert">Lost mode: you get a notification each time it checks in.</div>}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" disabled={!d.pushEndpoint || busy === `push-${d.id}`} onClick={() => act(`push-${d.id}`, async () => (await call("POST", { id: d.id, how: "push" }, "/api/finder/ring"), setNotice(`Rang ${d.name} by notification.`)))} title={d.pushEndpoint ? "" : "Pick its browser below first"}>
                {busy === `push-${d.id}` ? <Loader2 size={13} className="animate-spin" /> : <BellRing size={13} />} Ring
              </Button>
              <Button size="sm" variant="ghost" disabled={!d.ringUrl || busy === `loud-${d.id}`} onClick={() => act(`loud-${d.id}`, async () => (await call("POST", { id: d.id, how: "loud" }, "/api/finder/ring"), setNotice(`${d.name} is ringing loudly.`)))} title={d.ringUrl ? "" : "Add its MacroDroid webhook below"}>
                <Volume2 size={13} /> Loud ring
              </Button>
              {d.last && (
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${d.last.lat},${d.last.lng}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md border border-line-strong px-2.5 text-xs pointer-coarse:h-9">
                  <Navigation size={13} /> Directions
                </a>
              )}
              <Button
                size="sm"
                variant={d.lost ? "primary" : "danger"}
                onClick={() =>
                  act(`lost-${d.id}`, async () => {
                    await call("PATCH", { id: d.id, lost: d.lost ? null : { message: "This phone is lost. Please call the owner." } });
                    await load();
                  })
                }
              >
                <ShieldAlert size={13} /> {d.lost ? "Found it" : "Mark lost"}
              </Button>
            </div>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-xs text-soft">Settings and setup</summary>
              <div className="mt-2 space-y-2">
                <label className="block text-xs text-soft">
                  Browser on this device (for Ring by notification)
                  <select
                    value={d.pushEndpoint ?? ""}
                    onChange={(e) => act(`b-${d.id}`, async () => (await call("PATCH", { id: d.id, pushEndpoint: e.target.value || null }), await load()))}
                    className="mt-1 w-full rounded-md border border-line bg-sunken px-2 py-1.5 text-sm text-fg"
                  >
                    <option value="">Not set</option>
                    {browsers.map((b) => (
                      <option key={b.endpoint} value={b.endpoint}>
                        {b.device}
                        {b.added ? ` (added ${timeAgo(b.added)})` : ""}
                      </option>
                    ))}
                  </select>
                  {!browsers.length && <span className="mt-1 block">Turn on notifications in Settings on that phone first.</span>}
                </label>
                <RingUrl device={d} onSave={(url) => act(`r-${d.id}`, async () => (await call("PATCH", { id: d.id, ringUrl: url || null }), await load(), setNotice("Saved.")))} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={() => act(`k-${d.id}`, async () => setSetup({ id: d.id, url: (await call("PATCH", { id: d.id, rekey: true })).url }))}>
                    <KeyRound size={13} /> New check-in address
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => confirm(`Remove ${d.name}?`) && act(`d-${d.id}`, async () => (await fetch(`/api/finder?id=${d.id}`, { method: "DELETE" }), await load()))}>
                    <Trash2 size={13} /> Remove
                  </Button>
                </div>
              </div>
            </details>
          </div>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            void act("add", async () => {
              const j = await call("POST", { name: newName.trim() });
              setSetup({ id: j.device.id, url: j.url });
              setNewName("");
              await load();
            });
          }}
          className="flex flex-col justify-center gap-2 rounded-xl border border-dashed border-line p-3"
        >
          <span className="text-sm font-semibold">Add a device</span>
          <div className="flex gap-2">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name, e.g. My Phone" maxLength={40} />
            <Button type="submit" disabled={busy === "add"}>
              <Plus size={14} /> Add
            </Button>
          </div>
        </form>
      </div>
      {devices === null && !error && <p className="mt-3 text-sm text-soft">Loading…</p>}

      {setup && <Setup url={setup.url} onClose={() => setSetup(null)} />}

      <p className="mt-6 text-xs text-soft">
        <MapPin size={12} className="inline" /> For a phone that&apos;s off, stolen or offline, use Google&apos;s{" "}
        <a href="https://www.google.com/android/find" target="_blank" rel="noopener noreferrer" className="text-data underline">
          Find My Device
        </a>{" "}
        too: it can lock and erase the whole phone, which a web app can&apos;t.
      </p>
    </div>
  );
}

function RingUrl({ device, onSave }: { device: Device; onSave: (url: string) => void }) {
  const [v, setV] = useState(device.ringUrl ?? "");
  return (
    <label className="block text-xs text-soft">
      Loud ring: MacroDroid webhook address
      <div className="mt-1 flex gap-2">
        <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="https://trigger.macrodroid.com/…/ring" className="font-mono text-xs" />
        <Button size="sm" variant="ghost" onClick={() => onSave(v.trim())}>
          Save
        </Button>
      </div>
    </label>
  );
}

/** Step-by-step setup of the helper app, with the device's private check-in address. */
function Setup({ url, onClose }: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const full = `${url}&loc=[last_loc_latlong]&acc=[last_loc_accuracy]&bat=[battery]&power=[power]`;
  const copy = (k: string, text: string) => void navigator.clipboard?.writeText(text).then(() => setCopied(k));
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={onClose}>
      <div className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-line bg-panel p-4 text-sm" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-semibold">Set up the phone (about 5 minutes)</h2>
        <p className="mb-3 text-soft">This address is shown only now and works only for this device: keep it private. You can make a new one any time.</p>
        <div className="mb-3 flex gap-2">
          <code className="min-w-0 flex-1 break-all rounded-md bg-sunken p-2 font-mono text-[11px] text-data">{full}</code>
          <Button size="sm" variant="ghost" onClick={() => copy("url", full)}>
            {copied === "url" ? <Check size={13} /> : <Copy size={13} />}
          </Button>
        </div>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            On the phone, install <b>MacroDroid</b> (free) from the Play Store, open it and allow <b>location</b> (&ldquo;Allow all the time&rdquo;) and battery &ldquo;unrestricted&rdquo;.
          </li>
          <li>
            Add a macro called <b>HIVEMIND check-in</b>. <b>Triggers</b> (add all three): <i>Regular interval</i> every 30 minutes; <i>Device events → Power off / Shutdown</i>; <i>Battery level</i> below 15%.
          </li>
          <li>
            <b>Actions</b>, in order: <i>Location → Force location update</i>; then <i>Connectivity → HTTP request</i>: method <b>GET</b>, URL = the address above (copy it).
          </li>
          <li>Save, then tap the macro&apos;s ▶ to test: this page shows the phone on the map within a minute.</li>
          <li>
            <b>Loud ring (optional):</b> add a second macro <b>HIVEMIND ring</b>. Trigger: <i>Webhook (URL)</i>, name it <code>ring</code>, and copy the address it shows (https://trigger.macrodroid.com/…/ring). Actions: <i>Volume change</i> (alarm, ring and media to 100%); <i>Play sound</i> (an alarm); <i>Torch on/off</i>; <i>Vibrate</i>. Paste that address in this device&apos;s settings under &ldquo;Loud ring&rdquo;.
          </li>
        </ol>
        <p className="mt-3 text-xs text-soft">Menu names can differ slightly between MacroDroid versions. If the map shows nothing, check MacroDroid&apos;s log for the HTTP request.</p>
        <div className="mt-4 flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

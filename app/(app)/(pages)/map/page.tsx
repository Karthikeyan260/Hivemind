"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { Car, Footprints, LocateFixed, Loader2, MapPin, Navigation, Search, Smartphone } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Button, cx, ErrorText, Input, PageHeader } from "@/components/ui";
import { useVoiceActions } from "@/components/voice/provider";
import { timeAgo } from "@/lib/client-api";
import { getFix, point, type Fix } from "@/lib/location";

type Place = { name: string; type: string; address: string; lat: number; lng: number; km: number; walk_min: number };
type Route = { km: number; minutes: number; mode: "car" | "walk"; steps: { text: string; km: number }[]; line: [number, number][]; to: { name: string; lat: number; lng: number }; navigate: string };
type Device = { id: string; name: string; lat: number; lng: number; accuracy: number; at: string };

const QUICK = ["park", "atm", "petrol bunk", "hospital", "medical shop", "restaurant", "tea shop", "cinema"];

export default function MapPage() {
  return (
    <Suspense>
      <MapView />
    </Suspense>
  );
}

function MapView() {
  const params = useSearchParams();
  const router = useRouter();
  const box = useRef<HTMLDivElement | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [where, setWhere] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dest, setDest] = useState(params.get("to") ?? "");
  const near = params.get("near");
  const to = params.get("to");
  const toName = params.get("name") ?? "";
  const mode = params.get("mode") === "walk" ? "walk" : "car";

  // Leaflet touches window: load it in the browser only.
  useEffect(() => {
    let off = false;
    void import("leaflet").then((mod) => {
      if (off || !box.current || map.current) return;
      L.current = mod;
      const m = mod.map(box.current, { zoomControl: true }).setView([13.0827, 80.2707], 12); // Chennai until we know
      mod.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
      layer.current = mod.layerGroup().addTo(m);
      map.current = m;
      setTimeout(() => m.invalidateSize(), 50);
    });
    return () => {
      off = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  const locate = useCallback(async () => {
    setError(null);
    const f = await getFix(0);
    if (!f) {
      setError("Location is off for this site. Allow it in the browser (the lock icon by the address) and tap Locate me.");
      return null;
    }
    setFix(f);
    void fetch(`/api/places?op=where&at=${point(f)}`)
      .then((r) => r.json())
      .then((w) => setWhere(w.address ?? null))
      .catch(() => {});
    return f;
  }, []);

  // On open: where you are, your devices, then whatever the address asked for (nearby / route).
  useEffect(() => {
    let off = false;
    void (async () => {
      const f = await locate();
      fetch("/api/location")
        .then((r) => r.json())
        .then((d) => !off && setDevices(d.devices ?? []))
        .catch(() => {});
      if (!f || off) return;
      setBusy(true);
      try {
        if (near) {
          const r = await (await fetch(`/api/places?op=nearby&what=${encodeURIComponent(near)}&at=${point(f)}`)).json();
          if (!off) setPlaces(r.places ?? []);
        } else setPlaces(null);
        if (to) {
          const r = await fetch(`/api/places?op=route&from=${point(f)}&to=${encodeURIComponent(to)}&mode=${mode}&name=${encodeURIComponent(toName)}`);
          const data = await r.json();
          if (!off) {
            if (r.ok) setRoute(data);
            else setError(data.error ?? "No route found.");
          }
        } else setRoute(null);
      } catch {
        if (!off) setError("Couldn't reach the map service. Try again.");
      } finally {
        if (!off) setBusy(false);
      }
    })();
    return () => {
      off = true;
    };
  }, [near, to, toName, mode, locate]);

  // Draw everything on the map.
  useEffect(() => {
    const mod = L.current;
    const m = map.current;
    const g = layer.current;
    if (!mod || !m || !g) return;
    g.clearLayers();
    const pts: [number, number][] = [];
    const dot = (lat: number, lng: number, color: string, label: string, r = 7) => {
      mod.circleMarker([lat, lng], { radius: r, color: "#0b1016", weight: 2, fillColor: color, fillOpacity: 1 }).bindTooltip(label).addTo(g);
      pts.push([lat, lng]);
    };
    for (const d of devices) if (!fix || d.name !== fix.device) dot(d.lat, d.lng, "#a78bfa", `${d.name} · ${timeAgo(d.at)}`, 6);
    if (fix) {
      if (fix.accuracy > 60) mod.circle([fix.lat, fix.lng], { radius: fix.accuracy, color: "#38bdf8", weight: 1, fillOpacity: 0.08 }).addTo(g);
      dot(fix.lat, fix.lng, "#38bdf8", "You are here", 8);
    }
    for (const p of places ?? []) dot(p.lat, p.lng, "#f5a524", `${p.name} · ${p.km} km`, 6);
    if (route) {
      mod.polyline(route.line, { color: "#f5a524", weight: 5, opacity: 0.9 }).addTo(g);
      dot(route.to.lat, route.to.lng, "#ef4444", route.to.name, 8);
      route.line.forEach((p) => pts.push(p));
    }
    if (pts.length > 1) m.fitBounds(mod.latLngBounds(pts), { padding: [30, 30], maxZoom: 17 });
    else if (pts.length === 1) m.setView(pts[0], 16);
  }, [fix, devices, places, route]);

  const go = (q: Record<string, string>) => router.replace(`/map?${new URLSearchParams(q)}`);

  useVoiceActions({
    map_route_mode: {
      description: "Map page: switch the route between car and walking. input: 'car' or 'walk'.",
      run: ({ input }) => {
        if (!to) return { error: "No route is open." };
        const m2 = /walk/i.test(String(input ?? "")) ? "walk" : "car";
        go({ to, name: toName, mode: m2 });
        return { mode: m2 };
      },
    },
    map_locate: {
      description: "Map page: find where I am now and centre the map on me.",
      run: async () => {
        const f = await locate();
        if (!f) return { error: "Location is blocked for this site: allow it in the browser." };
        map.current?.setView([f.lat, f.lng], 16);
        return { located: true, accuracy_m: Math.round(f.accuracy) };
      },
    },
    map_nearby: {
      description: "Map page: show a kind of place near me on the map and in the list. input: park, atm, petrol bunk, hospital, medical shop, restaurant, tea shop, cinema, temple…",
      run: ({ input }) => {
        const what = String(input ?? "").trim();
        if (!what) return { error: "Say what to look for." };
        go({ near: what });
        return { showing: what, note: "The list fills in a moment; read it with map_list." };
      },
    },
    map_list: {
      description: "Map page: read what's listed now: the nearby places (nearest first) or the open route's distance, time and steps.",
      run: () => ({
        places: places?.slice(0, 8).map((p, i) => `${i + 1}. ${p.name}, ${p.km} km, ${p.walk_min} min walk`) ?? null,
        route: route ? { to: route.to.name, km: route.km, minutes: route.minutes, mode: route.mode, steps: route.steps.map((s) => s.text) } : null,
      }),
    },
    map_way_to: {
      description: "Map page: show the route to a place. input: the place ('AGS Cinemas Villivakkam'), or a number to route to that place in the list ('2'). Add 'walk' for walking.",
      run: ({ input }) => {
        const q = String(input ?? "").trim();
        const walk = /\bwalk(ing)?\b/i.test(q);
        const n = Number(q.match(/^\s*(?:number\s*)?(\d+)/i)?.[1]);
        if (n && places?.[n - 1]) {
          const p = places[n - 1];
          go({ to: `${p.lat},${p.lng}`, name: p.name, mode: walk || p.km < 1.5 ? "walk" : "car" });
          return { route_to: p.name };
        }
        const place = q.replace(/\b(walk(ing)?|by car|on foot)\b/gi, "").trim();
        if (!place) return { error: "Say where to." };
        go({ to: place, mode: walk ? "walk" : "car" });
        return { route_to: place };
      },
    },
    map_start_navigation: {
      description: "Map page: start turn-by-turn navigation for the open route in Google Maps.",
      run: () => {
        if (!route) return { error: "No route is open. Ask for the way somewhere first." };
        const w = window.open(route.navigate, "_blank", "noopener");
        return w ? { opened: "Google Maps" } : { blocked: "The browser blocked it: ask the owner to tap Start navigation on screen." };
      },
    },
    map_zoom: {
      description: "Map page: zoom the map. input: 'in' or 'out'.",
      run: ({ input }) => {
        if (/out/i.test(String(input ?? ""))) map.current?.zoomOut();
        else map.current?.zoomIn();
        return { zoom: map.current?.getZoom() };
      },
    },
    map_devices: {
      description: "Map page: show all my devices on the map and say where each one last was.",
      run: () => {
        go({});
        return { devices: devices.map((d) => `${d.name}, last seen ${timeAgo(d.at)}`) };
      },
    },
  });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Map" subtitle="Where you are, your devices, places near you and the way there (OpenStreetMap)." />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => void locate()}>
          <LocateFixed size={13} /> Locate me
        </Button>
        {fix && (
          <span className="text-sm">
            <MapPin size={13} className="mr-1 inline text-data" />
            {where ?? "Finding the address…"}
            <span className="ml-2 font-mono text-[11px] text-faint">{fix.accuracy > 200 ? `approximate (±${Math.round(fix.accuracy)} m, ${fix.device})` : `±${Math.round(fix.accuracy)} m`}</span>
          </span>
        )}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {QUICK.map((q) => (
          <button key={q} type="button" onClick={() => go({ near: q })} className={cx("rounded-full border px-2.5 py-1 text-xs", near === q ? "border-core bg-core/10 text-core" : "border-line text-soft hover:border-data hover:text-data")}>
            {q}
          </button>
        ))}
      </div>

      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (dest.trim()) go({ to: dest.trim(), mode });
        }}
      >
        <Input placeholder="Way to… (e.g. AGS Cinemas Villivakkam)" value={dest} onChange={(e) => setDest(e.target.value)} />
        <Button type="submit" disabled={!dest.trim() || !fix}>
          <Search size={14} /> Go
        </Button>
      </form>

      <ErrorText error={error} />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="relative overflow-hidden rounded-xl border border-line">
          <div ref={box} className="h-[58vh] min-h-[320px] w-full bg-sunken" />
          {busy && (
            <div className="absolute right-3 top-3 z-[500] flex items-center gap-1.5 bg-[#0b1016]/90 px-2 py-1 text-xs text-soft">
              <Loader2 size={12} className="animate-spin" /> working…
            </div>
          )}
        </div>

        <aside className="space-y-3">
          {route && (
            <div className="rounded-xl border border-core/50 bg-panel p-3">
              <div className="mb-1 text-xs text-soft">Way to</div>
              <div className="font-medium">{route.to.name}</div>
              <div className="mt-1 text-2xl font-semibold">
                {route.km} km <span className="text-base font-normal text-soft">· {route.minutes} min</span>
              </div>
              <div className="mt-2 flex gap-1.5">
                <button type="button" onClick={() => go({ to: to!, name: toName, mode: "car" })} className={cx("flex items-center gap-1 rounded-md border px-2 py-1 text-xs", route.mode === "car" ? "border-core text-core" : "border-line text-soft")}>
                  <Car size={12} /> Car / bike
                </button>
                <button type="button" onClick={() => go({ to: to!, name: toName, mode: "walk" })} className={cx("flex items-center gap-1 rounded-md border px-2 py-1 text-xs", route.mode === "walk" ? "border-core text-core" : "border-line text-soft")}>
                  <Footprints size={12} /> Walk
                </button>
              </div>
              <a href={route.navigate} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center justify-center gap-1.5 rounded-md bg-core px-3 py-2 text-sm font-medium text-core-ink hover:bg-core/85">
                <Navigation size={14} /> Start navigation
              </a>
              <ol className="mt-3 max-h-56 space-y-1 overflow-y-auto text-xs">
                {route.steps.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-4 shrink-0 text-right font-mono text-faint">{i + 1}</span>
                    <span>
                      {s.text}
                      {s.km >= 0.1 && <span className="text-soft"> · {s.km} km</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {places && (
            <div className="rounded-xl border border-line bg-panel p-3">
              <div className="mb-2 text-xs text-soft">{places.length ? `${near} near you` : `No ${near} found within 3 km`}</div>
              <ul className="space-y-1.5">
                {places.map((p) => (
                  <li key={`${p.lat},${p.lng}`}>
                    <button type="button" onClick={() => go({ to: `${p.lat},${p.lng}`, name: p.name, mode: p.km < 1.5 ? "walk" : "car" })} className="w-full rounded-md p-1.5 text-left text-sm hover:bg-raised">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-soft">
                        {p.km} km · {p.walk_min} min walk · {p.address}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {devices.length > 0 && (
            <div className="rounded-xl border border-line bg-panel p-3">
              <div className="mb-2 text-xs text-soft">Your devices</div>
              <ul className="space-y-1 text-sm">
                {devices.map((d) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <Smartphone size={13} className="text-[#a78bfa]" />
                    <span className="flex-1">{d.name}</span>
                    <span className="font-mono text-[11px] text-faint">{timeAgo(d.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

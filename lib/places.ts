import "server-only";

/**
 * Places for "where am I", "parks near me" and "the way to AGS Villivakkam", from free map services:
 * OpenStreetMap's Nominatim (addresses, search, nearby) and OSRM (car and walking routes).
 * Nominatim allows one request a second and asks for a named client: both handled here.
 */
export type LatLng = { lat: number; lng: number };
export type Place = { name: string; type: string; address: string; lat: number; lng: number; km: number; walk_min: number };
export type Step = { text: string; km: number };
export type Route = { km: number; minutes: number; mode: "car" | "walk"; steps: Step[]; line: [number, number][]; from: LatLng; to: LatLng & { name: string } };

const UA = { "User-Agent": "HIVEMIND-personal-assistant/1.0 (private, single user)", "Accept-Language": "en" };

// ---------- Nominatim: one request a second, answers cached ----------
let queue: Promise<unknown> = Promise.resolve();
let last = 0;
const cache = new Map<string, { at: number; data: unknown }>();

async function nominatim<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `https://nominatim.openstreetmap.org/${path}?${new URLSearchParams({ format: "jsonv2", ...params })}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.data as T;
  const run = queue.then(async () => {
    const wait = 1100 - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!res.ok) throw new Error(`Map lookup failed (${res.status})`);
    return res.json();
  });
  queue = run.catch(() => {});
  const data = (await run) as T;
  cache.set(url, { at: Date.now(), data });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return data;
}

/** Straight-line distance in km. */
export function km(a: LatLng, b: LatLng) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const walkMin = (k: number) => Math.max(1, Math.round((k * 1.25 * 60) / 4.8)); // roads aren't straight: +25%

type NomAddress = Record<string, string | undefined>;
type NomPlace = { lat: string; lon: string; name?: string; display_name: string; type?: string; category?: string; address?: NomAddress };

/** "Thiru Vi Ka Road, Villivakkam, Chennai" from a full OpenStreetMap address. */
function short(a: NomAddress | undefined, full: string) {
  if (!a) return full.split(",").slice(0, 3).join(",").trim();
  const parts = [a.road ?? a.pedestrian ?? a.amenity, a.neighbourhood ?? a.suburb ?? a.quarter, a.city_district ?? a.city ?? a.town ?? a.village].filter(Boolean);
  return [...new Set(parts)].join(", ") || full.split(",").slice(0, 3).join(",").trim();
}

/** The address of a spot, in words. */
export async function whereIs(at: LatLng) {
  const r = await nominatim<NomPlace & { error?: string }>("reverse", { lat: String(at.lat), lon: String(at.lng), zoom: "18", addressdetails: "1" });
  if (r.error) return { address: "an unnamed spot", area: "", city: "", full: "" };
  const a = r.address ?? {};
  return {
    address: short(a, r.display_name),
    area: a.suburb ?? a.neighbourhood ?? a.city_district ?? "",
    city: a.city ?? a.town ?? a.state_district ?? "",
    full: r.display_name,
  };
}

/** Everyday words → what OpenStreetMap calls them. */
const KIND: Record<string, string> = {
  "petrol bunk": "petrol station",
  bunk: "petrol station",
  petrol: "petrol station",
  "gas station": "petrol station",
  "tea shop": "cafe",
  "tea kadai": "cafe",
  coffee: "cafe",
  "medical shop": "pharmacy",
  medical: "pharmacy",
  "bus stop": "bus stop",
  "metro station": "subway station",
  metro: "subway station",
  temple: "hindu temple",
  theatre: "cinema",
  theater: "cinema",
  "movie theatre": "cinema",
  hotel: "restaurant",
  mess: "restaurant",
  gym: "fitness centre",
  toilet: "toilets",
  "ev charger": "charging station",
};

/** Places of a kind around a spot ("park", "atm", "petrol bunk"), nearest first. */
export async function nearby(what: string, at: LatLng, radiusKm = 3): Promise<Place[]> {
  const kind = KIND[what.toLowerCase().trim()] ?? what.trim();
  const d = radiusKm / 111; // degrees of latitude per km
  const dLng = d / Math.cos((at.lat * Math.PI) / 180);
  const r = await nominatim<NomPlace[]>("search", {
    q: kind,
    viewbox: `${at.lng - dLng},${at.lat + d},${at.lng + dLng},${at.lat - d}`,
    bounded: "1",
    limit: "20",
    addressdetails: "1",
  });
  return r
    .map((p) => {
      const pos = { lat: +p.lat, lng: +p.lon };
      const k = km(at, pos);
      return { name: p.name || p.display_name.split(",")[0], type: p.type ?? kind, address: short(p.address, p.display_name), ...pos, km: Math.round(k * 100) / 100, walk_min: walkMin(k) };
    })
    .filter((p) => p.km <= radiusKm * 1.5)
    .sort((a, b) => a.km - b.km)
    .slice(0, 10);
}

/** A named place ("AGS Cinemas Villivakkam"), preferring the one nearest to you. */
export async function findPlace(query: string, near?: LatLng): Promise<(LatLng & { name: string; address: string }) | null> {
  const box: Record<string, string> = near ? { viewbox: `${near.lng - 0.3},${near.lat + 0.3},${near.lng + 0.3},${near.lat - 0.3}` } : {};
  const r = await nominatim<NomPlace[]>("search", { q: query, limit: "5", addressdetails: "1", countrycodes: "in", ...box });
  if (!r.length) return null;
  const best = near ? [...r].sort((a, b) => km(near, { lat: +a.lat, lng: +a.lon }) - km(near, { lat: +b.lat, lng: +b.lon }))[0] : r[0];
  return { name: best.name || best.display_name.split(",")[0], address: short(best.address, best.display_name), lat: +best.lat, lng: +best.lon };
}

type OsrmStep = { distance: number; name: string; maneuver: { type: string; modifier?: string; exit?: number } };

/** "Turn left onto Paper Mills Road" from an OSRM step. */
function say(s: OsrmStep) {
  const road = s.name ? ` onto ${s.name}` : "";
  const m = s.maneuver;
  switch (m.type) {
    case "depart":
      return `Start${s.name ? ` on ${s.name}` : ""}`;
    case "arrive":
      return "You've arrived";
    case "roundabout":
    case "rotary":
      return `At the roundabout, take exit ${m.exit ?? 1}${road}`;
    case "merge":
      return `Merge${road}`;
    case "fork":
      return `Keep ${m.modifier ?? "straight"} at the fork${road}`;
    case "end of road":
      return `At the end of the road, turn ${m.modifier ?? ""}${road}`.replace(/\s+/g, " ");
    default:
      if (m.modifier === "straight") return `Go straight${road}`;
      return m.modifier ? `Turn ${m.modifier}${road}` : `Continue${road}`;
  }
}

/** The way from A to B by car or on foot. */
export async function route(from: LatLng, to: LatLng & { name: string }, mode: "car" | "walk" = "car"): Promise<Route> {
  const base = mode === "walk" ? "https://routing.openstreetmap.de/routed-foot/route/v1/driving" : "https://router.project-osrm.org/route/v1/driving";
  const res = await fetch(`${base}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`, { headers: UA, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  const data = (await res.json()) as { code: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: { steps: OsrmStep[] }[] }[] };
  const r = data.routes?.[0];
  if (data.code !== "Ok" || !r) throw new Error("No route found there.");
  // Walking speed from the foot profile; car time from the demo server is free-flow, so allow for city traffic.
  const minutes = Math.max(1, Math.round((r.duration / 60) * (mode === "car" ? 1.8 : 1)));
  return {
    km: Math.round(r.distance / 100) / 10,
    minutes,
    mode,
    steps: r.legs[0].steps.filter((s) => s.maneuver.type !== "new name" || s.distance > 50).map((s) => ({ text: say(s), km: Math.round(s.distance / 100) / 10 })),
    line: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    from,
    to,
  };
}

/** Turn-by-turn in Google Maps (the app on a phone). */
export const navigateLink = (from: LatLng, to: LatLng, mode: "car" | "walk") =>
  `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${mode === "walk" ? "walking" : "driving"}`;

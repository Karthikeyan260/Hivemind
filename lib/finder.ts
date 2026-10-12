import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readJSON, writeJSON } from "@/lib/private-store";
import { notify, notifyOne } from "@/lib/push";
import { safeFetch } from "@/lib/safe-fetch";

/**
 * Find my devices. A small automation app on each phone (MacroDroid, free) sends its location and
 * battery to a private address every so often and on events (power off, low battery), even with
 * HIVEMIND closed, so the last place each device was is always known. "Ring" sends a push
 * notification to that device, or (loud ring) calls the helper app's own webhook, which can play an
 * alarm at full volume even on silent. "Lost" mode tells the owner every time the device checks in.
 * Each device has its own random key; only its hash is stored.
 */
export type Ping = { lat: number; lng: number; acc?: number; battery?: number; charging?: boolean; event?: string; at: string };
export type FinderDevice = {
  id: string;
  name: string;
  keyHash: string;
  created: string;
  /** MacroDroid "Webhook" trigger URL that plays the loud alarm. */
  ringUrl?: string;
  /** The push subscription (browser) on this device, for a notification ring. */
  pushEndpoint?: string;
  lost?: { since: string; message: string; notifiedAt?: string };
  last?: Ping;
  trail: Ping[];
};
const KEY = "finder/devices";
const TRAIL = 60;
const hash = (k: string) => createHash("sha256").update(k).digest("hex");

export const listFinder = (supabase: SupabaseClient) => readJSON<FinderDevice[]>(supabase, KEY, []);
const saveAll = (supabase: SupabaseClient, all: FinderDevice[]) => writeJSON(supabase, KEY, all);

/** The owner's view (never the key hash). */
export const publicView = (d: FinderDevice) => {
  const { keyHash: _k, ...rest } = d;
  void _k;
  return rest;
};

/** A new device and its key (shown once: it goes into the helper app's address). */
export async function addFinder(supabase: SupabaseClient, name: string) {
  const all = await listFinder(supabase);
  if (all.length >= 8) throw new Error("Up to 8 devices.");
  const key = randomBytes(24).toString("base64url");
  const d: FinderDevice = { id: crypto.randomUUID(), name: name.trim().slice(0, 40) || "My phone", keyHash: hash(key), created: new Date().toISOString(), trail: [] };
  await saveAll(supabase, [...all, d]);
  return { device: d, key };
}

/** A fresh key for a device (the old address stops working). */
export async function rekeyFinder(supabase: SupabaseClient, id: string) {
  const all = await listFinder(supabase);
  const d = all.find((x) => x.id === id);
  if (!d) return null;
  const key = randomBytes(24).toString("base64url");
  d.keyHash = hash(key);
  await saveAll(supabase, all);
  return key;
}

export async function updateFinder(supabase: SupabaseClient, id: string, patch: { name?: string; ringUrl?: string | null; pushEndpoint?: string | null; lost?: { message: string } | null }) {
  const all = await listFinder(supabase);
  const d = all.find((x) => x.id === id);
  if (!d) return null;
  if (patch.name !== undefined) d.name = patch.name.trim().slice(0, 40) || d.name;
  if (patch.ringUrl !== undefined) {
    if (patch.ringUrl && !isRingUrl(patch.ringUrl)) throw new Error("That isn't a MacroDroid webhook address (https://trigger.macrodroid.com/…).");
    d.ringUrl = patch.ringUrl || undefined;
  }
  if (patch.pushEndpoint !== undefined) d.pushEndpoint = patch.pushEndpoint || undefined;
  if (patch.lost !== undefined) d.lost = patch.lost ? { since: d.lost?.since ?? new Date().toISOString(), message: patch.lost.message.slice(0, 200) } : undefined;
  await saveAll(supabase, all);
  return d;
}

export async function removeFinder(supabase: SupabaseClient, id: string) {
  await saveAll(supabase, (await listFinder(supabase)).filter((x) => x.id !== id));
}

/** Only MacroDroid's own webhook host: the server calls this address, so nothing else is allowed. */
export const isRingUrl = (u: string) => /^https:\/\/trigger\.macrodroid\.com\/[\w-]{6,80}\/[\w-]{1,60}(\?[\w=&%-]*)?$/.test(u);

const num = (v: unknown) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const t = String(v ?? "").trim().replace(/%$/, "");
  // Missing or blank is "not given", never 0.
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

/** Turns the helper app's values into a ping: "lat,lng" or lat & lng, accuracy, battery %, charging. */
export function parsePing(q: Record<string, unknown>): Omit<Ping, "at"> | null {
  let lat = num(q.lat);
  let lng = num(q.lng ?? q.lon);
  const loc = String(q.loc ?? q.latlng ?? "");
  if ((lat === undefined || lng === undefined) && loc.includes(",")) {
    const [a, b] = loc.split(",");
    lat = num(a);
    lng = num(b);
  }
  if (lat === undefined || lng === undefined || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  const battery = num(q.bat ?? q.battery);
  const power = String(q.charging ?? q.power ?? "").toLowerCase();
  const acc = num(q.acc);
  return {
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    ...(acc !== undefined && acc >= 0 ? { acc: Math.round(acc) } : {}),
    ...(battery !== undefined && battery >= 0 && battery <= 100 ? { battery: Math.round(battery) } : {}),
    ...(power ? { charging: ["on", "true", "1", "yes", "charging", "connected"].includes(power) } : {}),
    ...(q.event ? { event: String(q.event).replace(/[^\w -]/g, "").slice(0, 30) } : {}),
  };
}

/** A check-in from a device's helper app. Unknown key: null. */
export async function recordPing(supabase: SupabaseClient, key: string, p: Omit<Ping, "at">) {
  const all = await listFinder(supabase);
  const d = all.find((x) => x.keyHash === hash(key));
  if (!d) return null;
  // A helper app firing several triggers at once: one check-in per 15 seconds is plenty.
  if (d.last && Date.now() - +new Date(d.last.at) < 15_000 && !p.event) return d;
  const ping: Ping = { ...p, at: new Date().toISOString() };
  d.last = ping;
  d.trail = [...d.trail, ping].slice(-TRAIL);
  // Lost: tell the owner where it is (at most every 10 minutes).
  let alerted = false;
  if (d.lost && (!d.lost.notifiedAt || Date.now() - +new Date(d.lost.notifiedAt) > 10 * 60_000)) {
    d.lost.notifiedAt = ping.at;
    alerted = true;
  }
  await saveAll(supabase, all);
  if (alerted)
    await notify(supabase, {
      title: `📍 Lost ${d.name} checked in`,
      body: `At ${ping.lat.toFixed(5)}, ${ping.lng.toFixed(5)}${ping.battery !== undefined ? ` · battery ${ping.battery}%` : ""}. Tap to see it on the map.`,
      url: "/find",
      tag: `finder-${d.id}`,
      sticky: true,
    }).catch(() => 0);
  return d;
}

/** Ring: a push to the device's browser (works with HIVEMIND closed), or the helper app's loud alarm. */
export async function ringDevice(supabase: SupabaseClient, id: string, how: "push" | "loud") {
  const d = (await listFinder(supabase)).find((x) => x.id === id);
  if (!d) throw new Error("No such device.");
  if (how === "loud") {
    if (!d.ringUrl) throw new Error(`Loud ring isn't set up for ${d.name}: add its MacroDroid webhook address on the Find page.`);
    const r = await safeFetch(d.ringUrl, { method: "GET" });
    if (!r.ok) throw new Error(`The helper app didn't answer (${r.status}). Is the phone online?`);
    return { rang: d.name, how };
  }
  if (!d.pushEndpoint) throw new Error(`Pick which browser is on ${d.name} first (Find page → Ring by notification).`);
  const sent = await notifyOne(supabase, d.pushEndpoint, {
    title: `📱 ${d.name}: here I am!`,
    body: "Someone is looking for this phone. Tap to play a loud sound.",
    url: "/find/ring",
    tag: "finder-ring",
    sticky: true,
    data: { ring: "1" },
  });
  if (!sent) throw new Error("The notification didn't go through (the phone may be offline, or notifications are off for HIVEMIND there).");
  return { rang: d.name, how };
}

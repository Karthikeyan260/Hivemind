"use client";

/**
 * This device's location for "where am I", "parks near me" and directions. Read only when asked (or
 * while the app is open with sharing on), never tracked in the background. With sharing on, the
 * last spot is kept server-side so another device can ask "where's my phone?".
 */
export type Fix = { lat: number; lng: number; accuracy: number; at: number; device: string };

const SHARE_KEY = "hivemind-share-location";
const ID_KEY = "hivemind-device-id";

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

export function deviceId() {
  let id = store.get(ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    store.set(ID_KEY, id);
  }
  return id;
}

/** "Android phone", "Windows laptop"… */
export function deviceName() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Windows/i.test(ua)) return "Windows laptop";
  if (/Mac/i.test(ua)) return "Mac";
  return "This device";
}

export const sharing = () => store.get(SHARE_KEY) === "on";

let last: Fix | null = null;
let lastReport = 0;

/** The freshest fix this page already has (for chat), if under 10 minutes old. */
export const lastFix = () => (last && Date.now() - last.at < 10 * 60_000 ? last : null);

/** Where this device is now. Asks the browser (the first time it shows a permission prompt). */
export function getFix(maxAgeMs = 60_000): Promise<Fix | null> {
  if (last && Date.now() - last.at < maxAgeMs) return Promise.resolve(last);
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        last = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: Date.now(), device: deviceName() };
        if (sharing()) void report(last);
        resolve(last);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: maxAgeMs },
    );
  });
}

async function report(f: Fix) {
  if (Date.now() - lastReport < 60_000) return;
  lastReport = Date.now();
  await fetch("/api/location", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: deviceId(), name: deviceName(), lat: f.lat, lng: f.lng, accuracy: f.accuracy }),
  }).catch(() => {});
}

/** Turn sharing on (asks for permission) or off (and forget this device's last spot). */
export async function setSharing(on: boolean) {
  store.set(SHARE_KEY, on ? "on" : "off");
  if (on) {
    lastReport = 0;
    return getFix(0);
  }
  await fetch(`/api/location?id=${encodeURIComponent(deviceId())}`, { method: "DELETE" }).catch(() => {});
  return null;
}

/** "13.1047,80.2092" for URLs. */
export const point = (f: { lat: number; lng: number }) => `${f.lat.toFixed(5)},${f.lng.toFixed(5)}`;

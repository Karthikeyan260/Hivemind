import type * as Ort from "onnxruntime-web";

let ort: Promise<typeof Ort> | null = null;

/** The on-device model runtime (browser only), loaded once for the wake word and the voiceprint. */
export function loadOrt() {
  ort ??= import("onnxruntime-web/wasm")
    .then((m) => {
      // The 14 MB runtime comes from the npm CDN (cached by the browser), not the app bundle.
      m.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${m.env.versions.web}/dist/`;
      m.env.wasm.numThreads = 1;
      return m as unknown as typeof Ort;
    })
    .catch((e) => {
      ort = null;
      throw e;
    });
  return ort;
}

/**
 * A model file, kept in the browser's Cache Storage after the first download so a 30 MB model
 * isn't fetched again every session.
 */
export async function modelBytes(url: string): Promise<Uint8Array> {
  const cache = typeof caches !== "undefined" ? await caches.open("hm-models").catch(() => null) : null;
  const hit = await cache?.match(url).catch(() => undefined);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Couldn't download the model (${r.status}).`);
  const buf = await r.arrayBuffer();
  await cache?.put(url, new Response(buf.slice(0))).catch(() => {});
  return new Uint8Array(buf);
}

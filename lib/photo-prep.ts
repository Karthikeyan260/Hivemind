"use client";

/**
 * On the phone, before a photo is sent: read when and where it was taken (EXIF, JPEG only) and make a
 * light copy (≈1600 px) and a thumbnail (≈400 px). Photos shared through WhatsApp have no EXIF; those
 * just get the date they were added.
 */
export type Exif = { taken?: string; lat?: number; lng?: number };

export function readExif(buf: ArrayBuffer): Exif {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return {};
  let off = 2;
  while (off + 4 < v.byteLength) {
    const marker = v.getUint16(off);
    const size = v.getUint16(off + 2);
    if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
    if ((marker & 0xff00) !== 0xff00 || size < 2) break;
    off += 2 + size;
  }
  return {};
}

function parseTiff(v: DataView, start: number): Exif {
  try {
    const le = v.getUint16(start) === 0x4949;
    const u16 = (o: number) => v.getUint16(start + o, le);
    const u32 = (o: number) => v.getUint32(start + o, le);
    /** Tag → value offset (relative to the TIFF start) in the IFD at `ifd`. */
    const tags = (ifd: number) => {
      const out = new Map<number, { type: number; count: number; at: number }>();
      const n = u16(ifd);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        const type = u16(e + 2);
        const count = u32(e + 4);
        const bytes = count * ([0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8][type] ?? 1);
        out.set(u16(e), { type, count, at: bytes > 4 ? u32(e + 8) : e + 8 });
      }
      return out;
    };
    const ascii = (t?: { count: number; at: number }) => (t ? Array.from({ length: t.count }, (_, i) => String.fromCharCode(v.getUint8(start + t.at + i))).join("").replace(/\0+$/, "") : "");
    const rational = (at: number) => u32(at) / (u32(at + 4) || 1);
    const ifd0 = tags(u32(4));
    const out: Exif = {};
    const exifPtr = ifd0.get(0x8769);
    const exif = exifPtr ? tags(u32(exifPtr.at)) : null;
    // "2024:12:25 18:30:05" (camera local time, no zone): read as local time.
    const dt = ascii(exif?.get(0x9003) ?? exif?.get(0x9004) ?? ifd0.get(0x0132));
    const m = dt.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      if (!Number.isNaN(+d) && +m[1] > 1990) out.taken = d.toISOString();
    }
    const gpsPtr = ifd0.get(0x8825);
    if (gpsPtr) {
      const g = tags(u32(gpsPtr.at));
      const deg = (t?: { at: number }) => (t ? rational(t.at) + rational(t.at + 8) / 60 + rational(t.at + 16) / 3600 : NaN);
      const lat = deg(g.get(2)) * (ascii(g.get(1)) === "S" ? -1 : 1);
      const lng = deg(g.get(4)) * (ascii(g.get(3)) === "W" ? -1 : 1);
      if (Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng)) {
        out.lat = Math.round(lat * 1e6) / 1e6;
        out.lng = Math.round(lng * 1e6) / 1e6;
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function jpeg(bmp: ImageBitmap, maxSide: number, quality: number) {
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", quality));
  if (!blob) throw new Error("Couldn't read that image.");
  return { blob, w, h };
}

/** The copy and thumbnail to send, plus when / where from the photo. */
export async function preparePhoto(file: File) {
  const exif = /jpe?g/i.test(file.type) ? readExif(await file.slice(0, 256 * 1024).arrayBuffer()) : {};
  // The browser turns phone photos the right way up (EXIF orientation) while decoding.
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const full = await jpeg(bmp, 1600, 0.82);
    const thumb = await jpeg(bmp, 420, 0.72);
    return { full: full.blob, thumb: thumb.blob, w: full.w, h: full.h, exif, taken: exif.taken };
  } finally {
    bmp.close();
  }
}

/** The browser's "file can't be read" errors, in plain words. */
const readable = (e: unknown) => {
  const name = (e as { name?: string })?.name;
  return name === "NotReadableError" || name === "NotFoundError" || /could not be read|permission problems/i.test(String((e as Error)?.message))
    ? "Your phone stopped letting HIVEMIND read one of the photos. Add it again (it works best straight from the Gallery or Files)."
    : e instanceof Error
      ? e.message
      : String(e);
};

/**
 * Send photos (each is shrunk here, stored, then described). Every photo is read and shrunk FIRST,
 * straight after it's picked: Android only lends the picked files for a short while, so reading the
 * 10th photo after the first nine have uploaded fails ("the requested file could not be read").
 */
export async function uploadPhotos(files: File[], opts: { private?: boolean; onProgress?: (done: number, total: number, failed: number, error?: string) => void } = {}) {
  const list = files.filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)).slice(0, 30);
  let failed = 0;
  let lastError: string | undefined;
  const ready: Awaited<ReturnType<typeof preparePhoto>>[] = [];
  for (const f of list) {
    try {
      ready.push(await preparePhoto(f));
    } catch (e) {
      failed++;
      lastError = readable(e);
    }
  }
  if (failed) opts.onProgress?.(0, list.length, failed, lastError);
  for (let i = 0; i < ready.length; i++) {
    let error: string | undefined;
    try {
      const p = ready[i];
      const form = new FormData();
      form.set("full", new File([p.full], "full.jpg", { type: "image/jpeg" }));
      form.set("thumb", new File([p.thumb], "thumb.jpg", { type: "image/jpeg" }));
      form.set("w", String(p.w));
      form.set("h", String(p.h));
      if (p.taken) form.set("taken", p.taken);
      if (p.exif.lat !== undefined && p.exif.lng !== undefined) {
        form.set("lat", String(p.exif.lat));
        form.set("lng", String(p.exif.lng));
      }
      if (opts.private) form.set("private", "1");
      const r = await fetch("/api/photos", { method: "POST", body: form });
      if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `Upload failed (${r.status})`);
    } catch (e) {
      failed++;
      error = readable(e);
    }
    opts.onProgress?.(list.length - ready.length + i + 1, list.length, failed, error);
  }
  return { total: list.length, failed };
}

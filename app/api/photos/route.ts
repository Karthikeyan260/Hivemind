import { NextResponse } from "next/server";
import { handle, HttpError } from "@/lib/api";
import { db } from "@/lib/db";
import { addPhoto, listPhotos, removePhoto, searchPhotos } from "@/lib/photos";

export const maxDuration = 60;
const MAX = 3 * 1024 * 1024;

/** Photos, newest first, or the ones matching ?q= ("Ooty trip", "birthday cake", "beach last December"). */
export const GET = handle(async (req: Request) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 120).trim();
  const all = await listPhotos(db());
  const photos = q ? searchPhotos(all, q).photos : [...all].sort((a, b) => b.taken.localeCompare(a.taken));
  return NextResponse.json({ photos: photos.slice(0, 300), total: all.length });
});

/** One photo from the phone: the light copy, the thumbnail, its size, and (from the photo) when and where. */
export const POST = handle(async (req: Request) => {
  const form = await req.formData().catch(() => null);
  const full = form?.get("full");
  const thumb = form?.get("thumb");
  if (!(full instanceof File) || !(thumb instanceof File)) throw new HttpError(400, "Send the photo and its thumbnail.");
  if (full.size > MAX || thumb.size > 512 * 1024) throw new HttpError(413, "That photo is too big.");
  if (full.type !== "image/jpeg" || thumb.type !== "image/jpeg") throw new HttpError(415, "Photos are sent as JPEG.");
  const num = (k: string) => {
    const v = form!.get(k);
    const n = typeof v === "string" && v.trim() ? Number(v) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  const taken = form!.get("taken");
  const r = await addPhoto(db(), {
    full: Buffer.from(await full.arrayBuffer()),
    thumb: Buffer.from(await thumb.arrayBuffer()),
    w: num("w") ?? 0,
    h: num("h") ?? 0,
    taken: typeof taken === "string" ? taken.slice(0, 40) : undefined,
    lat: num("lat"),
    lng: num("lng"),
    private: form!.get("private") === "1",
  });
  return NextResponse.json(r, { status: 201 });
});

export const DELETE = handle(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, "Which photo?");
  await removePhoto(db(), id);
  return NextResponse.json({ ok: true });
});

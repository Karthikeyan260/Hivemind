import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parsePing, recordPing } from "@/lib/finder";

/**
 * A device's helper app checking in (open: it carries that device's own secret key). Accepts GET with
 * query values or POST with JSON / form values: k, loc ("lat,lng") or lat & lng, acc, bat, power, event.
 */
async function handlePing(req: Request) {
  const url = new URL(req.url);
  const q: Record<string, unknown> = Object.fromEntries(url.searchParams);
  if (req.method === "POST") {
    const type = req.headers.get("content-type") ?? "";
    try {
      if (type.includes("json")) Object.assign(q, await req.json());
      else if (type.includes("form")) Object.assign(q, Object.fromEntries(await req.formData()));
    } catch {}
  }
  const key = String(q.k ?? q.key ?? "");
  if (!/^[\w-]{20,64}$/.test(key)) return NextResponse.json({ error: "No key" }, { status: 401 });
  const ping = parsePing(q);
  if (!ping) return NextResponse.json({ error: "No location in the request (send loc=lat,lng)" }, { status: 400 });
  const d = await recordPing(db(), key, ping);
  if (!d) return NextResponse.json({ error: "Unknown key" }, { status: 401 });
  return NextResponse.json({ ok: true, device: d.name, lost: !!d.lost });
}

export const GET = (req: Request) => handlePing(req).catch(() => NextResponse.json({ error: "Failed" }, { status: 500 }));
export const POST = GET;

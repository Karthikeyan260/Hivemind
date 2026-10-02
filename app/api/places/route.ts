import { NextResponse } from "next/server";
import { handle, HttpError } from "@/lib/api";
import { findPlace, navigateLink, nearby, route, whereIs } from "@/lib/places";

export const maxDuration = 30;

const point = (s: string | null) => {
  const m = s?.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
};

/**
 * Map data for the Map page: ?op=where&at=lat,lng · ?op=nearby&what=park&at=… · ?op=route&from=…&to=AGS%20Villivakkam&mode=walk
 */
export const GET = handle(async (req: Request) => {
  const p = new URL(req.url).searchParams;
  const op = p.get("op");
  if (op === "where") {
    const at = point(p.get("at"));
    if (!at) throw new HttpError(400, "Need at=lat,lng");
    return NextResponse.json(await whereIs(at));
  }
  if (op === "nearby") {
    const at = point(p.get("at"));
    const what = (p.get("what") ?? "").trim().slice(0, 60);
    if (!at || !what) throw new HttpError(400, "Need what and at=lat,lng");
    return NextResponse.json({ what, places: await nearby(what, at, Number(p.get("km")) || 3) });
  }
  if (op === "route") {
    const from = point(p.get("from"));
    const to = (p.get("to") ?? "").trim().slice(0, 120);
    if (!from || !to) throw new HttpError(400, "Need from=lat,lng and to");
    const dest = point(to) ? { ...point(to)!, name: p.get("name") ?? "Destination" } : await findPlace(to, from);
    if (!dest) throw new HttpError(404, `Couldn't find "${to}" on the map.`);
    const mode = p.get("mode") === "walk" ? "walk" : "car";
    const r = await route(from, dest, mode);
    return NextResponse.json({ ...r, navigate: navigateLink(from, dest, mode) });
  }
  throw new HttpError(400, "Unknown op");
});

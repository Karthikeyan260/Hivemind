import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { listApps } from "@/lib/apps";
import { listScreened } from "@/lib/call-screen";
import { db } from "@/lib/db";
import { getWeather } from "@/lib/external/weather";
import { getPins, setPins } from "@/lib/panels";
import { listRoutines } from "@/lib/routines";

/** The home panels: what's pinned, plus the data each pinned card shows. */
export const GET = handle(async () => {
  const supabase = db();
  const pinned = await getPins(supabase);
  const has = (p: string) => pinned.includes(p as never);
  const [apps, weather, calls, routines] = await Promise.all([
    listApps(supabase).catch(() => []),
    has("weather") ? getWeather().catch(() => null) : null,
    has("calls") ? listScreened(supabase).catch(() => []) : null,
    has("routines") ? listRoutines(supabase).catch(() => []) : null,
  ]);
  return NextResponse.json({
    pinned,
    apps: apps.filter((a) => a.status === "ready").map((a) => ({ id: a.id, name: a.name, emoji: a.emoji })),
    weather: weather && { place: weather.place, now: weather.current, today: weather.days[0] ?? null },
    calls: calls && { unread: calls.filter((c) => !c.read).length, latest: calls.slice(0, 3).map((c) => ({ id: c.id, caller: c.caller, why: c.summary || c.reason, urgent: c.urgent, at: c.at, read: !!c.read })) },
    routines: routines && routines.map((r) => ({ id: r.id, name: r.name, steps: r.steps.length })),
  });
});

export const PUT = handle(async (req: Request) => {
  const { pinned } = await parseBody(req, z.object({ pinned: z.array(z.string().max(60)).max(8) }));
  return NextResponse.json({ pinned: await setPins(db(), pinned) });
});

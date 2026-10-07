import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { personalRoom } from "@/lib/call-rooms";
import { deleteScreened, getScreenSettings, listScreened, markScreenedRead, setScreenSettings } from "@/lib/call-screen";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/profile";

const host = async () => (await getProfile(db()).catch(() => null))?.name?.split(" ")[0] || "HIVEMIND";
const linkOf = (origin: string, room: string, from: string) => `${origin}/call/${room}?from=${encodeURIComponent(from)}`;

/** Calls page: screening settings, the permanent "call me" link, and the calls HIVEMIND answered. */
export const GET = handle(async (req: Request) => {
  const supabase = db();
  const from = await host();
  const [settings, items, me] = await Promise.all([getScreenSettings(supabase), listScreened(supabase), personalRoom(supabase, from)]);
  const origin = process.env.APP_URL || new URL(req.url).origin;
  return NextResponse.json({ settings, items, link: linkOf(origin, me.room, me.from) });
});

const Patch = z.object({
  settings: z.object({ mode: z.enum(["missed", "always", "off"]), wait_s: z.number().int().min(10).max(60), my_voice: z.boolean() }).partial().optional(),
  read: z.array(z.uuid()).max(100).optional(),
  read_all: z.boolean().optional(),
  reset_link: z.boolean().optional(),
});

export const PATCH = handle(async (req: Request) => {
  const body = await parseBody(req, Patch);
  const supabase = db();
  if (body.settings) await setScreenSettings(supabase, body.settings);
  if (body.read || body.read_all) await markScreenedRead(supabase, body.read_all ? undefined : body.read);
  if (body.reset_link) await personalRoom(supabase, await host(), true);
  return NextResponse.json({ ok: true });
});

export const DELETE = handle(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id");
  await deleteScreened(db(), id && z.uuid().safeParse(id).success ? id : undefined);
  return NextResponse.json({ ok: true });
});

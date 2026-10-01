import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { getPrefs, setPrefs } from "@/lib/prefs";

export const GET = handle(async () => NextResponse.json(await getPrefs(db())));

export const PUT = handle(async (req: Request) => {
  const patch = await parseBody(req, z.object({ language: z.enum(["auto", "en", "ta"]).optional() }));
  return NextResponse.json(await setPrefs(db(), patch));
});

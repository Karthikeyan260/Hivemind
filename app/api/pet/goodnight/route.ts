import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { goodNight } from "@/lib/goodnight";

/** "Nova, good night": tomorrow in two lines and a calm song (read-only). */
export const GET = handle(async () => NextResponse.json(await goodNight(db())));

import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { listSessions } from "@/lib/session";

/** Browsers currently signed in (Settings → Signed-in devices). */
export const GET = handle(async () => NextResponse.json({ sessions: await listSessions() }));

import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { systemCheck } from "@/lib/health";

/** Settings → System check (owner only, like every API route). */
export const GET = handle(async () => NextResponse.json({ checks: await systemCheck(db()) }));

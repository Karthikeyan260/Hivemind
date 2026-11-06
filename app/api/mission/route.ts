import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { loadMission } from "@/lib/mission-load";

/** What every background agent is doing right now, for Mission Control. */
export const GET = handle(async () => NextResponse.json(await loadMission(db())));

import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { getGarden } from "@/lib/garden";

/** Nova's garden: everything grown on its island from habits, check-ins, walks, wins and songs. */
export const GET = handle(async () => NextResponse.json({ garden: await getGarden(db()) }));

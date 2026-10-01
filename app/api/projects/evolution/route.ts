import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { buildEvolution } from "@/lib/evolution";

export const maxDuration = 30;

/** Projects in real build order (GitHub), with what each learned and reused, for the Evolution view. */
export const GET = handle(async () => NextResponse.json(await buildEvolution(db())));

import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { buildLivingMemory } from "@/lib/living-memory";

export const maxDuration = 30;

/** Memories, project clusters, skill hubs and related-memory links for the Projects "Living Memory" view. */
export const GET = handle(async () => NextResponse.json(await buildLivingMemory(db())));

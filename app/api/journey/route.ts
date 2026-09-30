import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { buildJourney } from "@/lib/journey";

/** The owner's career as git-graph commits, built from their portfolio memories. */
export const GET = handle(async () => NextResponse.json(await buildJourney(db())));

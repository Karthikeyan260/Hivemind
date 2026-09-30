import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { listMemories } from "@/lib/memory-explorer";

export const maxDuration = 30;

/** Memory Explorer list: ?q= (meaning + words) &type= &category= &project= &source= &sort= &system=1 */
export const GET = handle(async (req: Request) => {
  const p = new URL(req.url).searchParams;
  const get = (k: string) => p.get(k) || undefined;
  return NextResponse.json(
    await listMemories(db(), { q: get("q"), type: get("type"), category: get("category"), project: get("project"), source: get("source"), sort: get("sort"), system: p.get("system") === "1" }),
  );
});

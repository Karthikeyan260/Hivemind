import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { memoryDetail } from "@/lib/memory-explorer";

export const maxDuration = 30;
type Ctx = { params: Promise<{ id: string }> };

/** One memory with its source, full history timeline, and related memories/notes/projects/skills. */
export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return NextResponse.json(await memoryDetail(db(), id));
});

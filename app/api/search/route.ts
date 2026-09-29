import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { searchKnowledge } from "@/lib/rag/retrieval";

export const POST = handle(async (req: Request) => {
  const supabase = db();
  const { query, project_id, limit } = await parseBody(
    req,
    z.object({
      query: z.string().trim().min(1).max(1000),
      project_id: z.uuid().nullable().optional(),
      limit: z.number().int().min(1).max(30).optional(),
    }),
  );
  const results = await searchKnowledge(supabase, query, { projectId: project_id, limit: limit ?? 12, minSimilarity: 0.3 });
  return NextResponse.json(results);
});

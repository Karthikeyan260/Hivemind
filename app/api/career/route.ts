import { NextResponse } from "next/server";
import { z } from "zod";
import { dbError, handle, parseBody } from "@/lib/api";
import { analyzeJob, CAREER_SOURCE } from "@/lib/career";
import { db } from "@/lib/db";

export const maxDuration = 60;

/** Past job analyses (newest first). */
export const GET = handle(async () => {
  const { data, error } = await db()
    .from("memories")
    .select("id, title, created_at, metadata")
    .eq("metadata->>source", CAREER_SOURCE)
    .order("created_at", { ascending: false })
    .limit(50);
  dbError(error);
  return NextResponse.json(
    (data ?? []).map((m) => {
      const a = (m.metadata as { analysis?: { role?: string; company?: string; fit_score?: number; ats_score?: number } }).analysis ?? {};
      return { id: m.id, title: m.title, created_at: m.created_at, role: a.role, company: a.company, fit_score: a.fit_score, ats_score: a.ats_score };
    }),
  );
});

export const POST = handle(async (req: Request) => {
  const body = await parseBody(
    req,
    z.object({
      jobDescription: z.string().trim().min(80, "Paste the full job description (at least a few lines).").max(20000),
      role: z.string().trim().max(120).optional(),
      company: z.string().trim().max(120).optional(),
    }),
  );
  return NextResponse.json(await analyzeJob(db(), body), { status: 201 });
});

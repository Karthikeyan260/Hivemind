import { NextResponse } from "next/server";
import { handle, HttpError } from "@/lib/api";
import { db } from "@/lib/db";
import { resumeResponse } from "@/lib/resume/download";
import { getMaster, getTailored, tailorResume } from "@/lib/resume/tailor";

export const runtime = "nodejs";
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

/** Create (or re-create) the resume tailored to this job analysis. */
export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return NextResponse.json(await tailorResume(db(), id), { status: 201 });
});

/** ?format=pdf | pdf-download | tex → file; otherwise the tailored resume JSON + change log. */
export const GET = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format");
  const supabase = db();
  const { tailored, analysis } = await getTailored(supabase, id);
  if (!format) return NextResponse.json(tailored);
  if (!tailored) throw new HttpError(404, "No tailored resume for this job yet");
  const master = await getMaster(supabase);
  return resumeResponse(tailored.resume, format, { latex: master?.latex, suffix: analysis.company || analysis.role });
});

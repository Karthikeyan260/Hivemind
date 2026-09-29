import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { resumeResponse } from "@/lib/resume/download";
import { getMaster, saveMaster } from "@/lib/resume/tailor";

export const runtime = "nodejs";
export const maxDuration = 30;

/** ?format=pdf | pdf-download | tex → file; otherwise JSON status. */
export const GET = handle(async (req: Request) => {
  const format = new URL(req.url).searchParams.get("format");
  const master = await getMaster(db());
  if (!format) {
    return NextResponse.json(
      master
        ? { exists: true, updated_at: master.updated_at, name: master.resume.name, headline: master.resume.headline, sections: master.resume.sections.map((s) => s.title) }
        : { exists: false },
    );
  }
  if (!master) throw new HttpError(404, "No master resume yet");
  return resumeResponse(master.resume, format, { latex: master.latex });
});

export const PUT = handle(async (req: Request) => {
  const { latex } = await parseBody(req, z.object({ latex: z.string().min(200, "Paste your full LaTeX resume.").max(100_000) }));
  const resume = await saveMaster(db(), latex);
  return NextResponse.json({ exists: true, name: resume.name, headline: resume.headline, sections: resume.sections.map((s) => s.title) });
});

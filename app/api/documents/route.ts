import { NextResponse } from "next/server";
import { z } from "zod";
import { dbError, handle, HttpError } from "@/lib/api";
import { db } from "@/lib/db";
import { detectType, MAX_UPLOAD_BYTES, parseToChunks } from "@/lib/documents/parse";
import { DOC_COLUMNS, storeDocument } from "@/lib/documents/store";
import { organizeItem } from "@/lib/organizer";

// PDF parsing + embedding can take a while; 60s is the Vercel Hobby ceiling.
export const maxDuration = 60;

export const GET = handle(async () => {
  const { data, error } = await db().from("documents").select(DOC_COLUMNS).order("created_at", { ascending: false });
  dbError(error);
  return NextResponse.json(data);
});

export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No file uploaded");
  if (file.size === 0) throw new HttpError(400, "File is empty");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "File too large (max 4MB on the free plan)");
  const type = detectType(file.name);
  if (!type) throw new HttpError(400, "Only PDF, TXT, Markdown, DOCX and CSV are supported");
  const projectRaw = form.get("project_id");
  const projectId = projectRaw ? z.uuid().parse(projectRaw) : null;

  const chunks = await parseToChunks(Buffer.from(await file.arrayBuffer()), type);
  const supabase = db();
  const doc = await storeDocument(supabase, { filename: file.name, fileType: type, projectId }, chunks);
  if (!projectId && doc) {
    await organizeItem(supabase, { table: "documents", id: doc.id, title: doc.filename, content: doc.summary ?? chunks[0].content });
  }
  return NextResponse.json(doc, { status: 201 });
});

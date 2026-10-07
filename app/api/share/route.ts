import { NextResponse } from "next/server";
import { handle, HttpError } from "@/lib/api";
import { db } from "@/lib/db";
import { saveShared } from "@/lib/share";

// Reading a page or a photo and filing it can take a while.
export const maxDuration = 60;

const str = (v: FormDataEntryValue | null, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

/** What was shared to HIVEMIND (Android Share menu, or pasted on the Share page): summarised and filed. */
export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > 5) throw new HttpError(400, "Up to 5 files at a time.");
  const results = await saveShared(db(), { title: str(form.get("title"), 300), text: str(form.get("text"), 5000), url: str(form.get("url"), 2000), files });
  return NextResponse.json({ results });
});

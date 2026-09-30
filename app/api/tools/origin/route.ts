import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { originOf } from "@/lib/origin";

/** The outside origin (URL) of a memory/note/document, for voice "where did that come from". */
export const GET = handle(async (req: Request) => {
  const u = new URL(req.url);
  return NextResponse.json({ origin: await originOf(db(), u.searchParams.get("type") ?? "", u.searchParams.get("id") ?? "") });
});

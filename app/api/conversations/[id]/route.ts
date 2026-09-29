import { NextResponse } from "next/server";
import { dbError, handle } from "@/lib/api";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const supabase = db();
  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, metadata, created_at")
    .eq("conversation_id", id)
    .order("created_at");
  dbError(error);
  return NextResponse.json(data);
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const supabase = db();
  const { error } = await supabase.from("conversations").delete().eq("id", id);
  dbError(error);
  return new NextResponse(null, { status: 204 });
});

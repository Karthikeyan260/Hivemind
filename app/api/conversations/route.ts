import { NextResponse } from "next/server";
import { dbError, handle } from "@/lib/api";
import { db } from "@/lib/db";

export const GET = handle(async () => {
  const supabase = db();
  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  dbError(error);
  return NextResponse.json(data);
});

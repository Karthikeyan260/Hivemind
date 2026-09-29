import { NextResponse } from "next/server";
import { z } from "zod";
import { dbError, handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";

const COLUMNS = "id, name, description, status, created_at, updated_at";

export const GET = handle(async () => {
  const supabase = db();
  const { data, error } = await supabase.from("projects").select(COLUMNS).order("updated_at", { ascending: false });
  dbError(error);
  return NextResponse.json(data);
});

export const POST = handle(async (req: Request) => {
  const supabase = db();
  const input = await parseBody(
    req,
    z.object({
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(2000).optional(),
    }),
  );
  const { data, error } = await supabase.from("projects").insert(input).select(COLUMNS).single();
  dbError(error);
  return NextResponse.json(data, { status: 201 });
});

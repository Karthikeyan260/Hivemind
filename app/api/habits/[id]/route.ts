import { NextResponse } from "next/server";
import { handle, HttpError } from "@/lib/api";
import { db } from "@/lib/db";
import { removeHabit } from "@/lib/habits";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  if (!(await removeHabit(db(), (await params).id))) throw new HttpError(404, "No such habit.");
  return new NextResponse(null, { status: 204 });
});

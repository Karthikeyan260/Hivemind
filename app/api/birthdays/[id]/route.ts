import { NextResponse } from "next/server";
import { handle, HttpError } from "@/lib/api";
import { removeBirthday } from "@/lib/birthdays";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  if (!(await removeBirthday(db(), (await params).id))) throw new HttpError(404, "Not found.");
  return new NextResponse(null, { status: 204 });
});

import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { readShot } from "@/lib/web-agent/store";

type Ctx = { params: Promise<{ id: string }> };

/** The task's latest screenshot. */
export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const shot = await readShot(db(), (await params).id);
  if (!shot) return new Response(null, { status: 404 });
  return new Response(shot, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" } });
});

import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { readShot } from "@/lib/web-agent/store";

type Ctx = { params: Promise<{ id: string }> };

/** The task's latest screenshot, or ?step=N for the page after step N (the replay). */
export const GET = handle(async (req: Request, { params }: Ctx) => {
  const raw = new URL(req.url).searchParams.get("step");
  const step = raw !== null && /^\d{1,3}$/.test(raw) ? Number(raw) : undefined;
  const shot = await readShot(db(), (await params).id, step);
  if (!shot) return new Response(null, { status: 404 });
  // A step's screenshot never changes; the latest one does.
  return new Response(shot, { headers: { "Content-Type": "image/jpeg", "Cache-Control": step === undefined ? "private, no-store" : "private, max-age=86400" } });
});

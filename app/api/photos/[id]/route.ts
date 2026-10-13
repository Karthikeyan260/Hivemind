import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { readPhoto } from "@/lib/photos";

type Ctx = { params: Promise<{ id: string }> };

/** A photo (?t=1 for its thumbnail). A photo never changes, so the browser keeps it. */
export const GET = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response(null, { status: 404 });
  const img = await readPhoto(db(), id, new URL(req.url).searchParams.get("t") === "1");
  if (!img) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(img), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=604800, immutable" } });
});

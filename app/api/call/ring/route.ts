import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { claimRing } from "@/lib/call-rooms";
import { db } from "@/lib/db";
import { notify } from "@/lib/push";

/**
 * Open to the invited guest (no password): rings the owner's devices when the guest joins a call link.
 * Only rooms the owner created in the last 24 h can ring, at most once every 30 seconds.
 */
export const POST = handle(async (req: Request) => {
  const { room } = await parseBody(req, z.object({ room: z.string().regex(/^[a-z0-9]{8,40}$/i) }));
  const supabase = db();
  const r = await claimRing(supabase, room);
  if (!r) return NextResponse.json({ rang: false });
  const q = new URLSearchParams({ host: "1", from: r.from, name: r.name, ...(r.to ? { to: r.to } : {}) });
  const sent = await notify(supabase, {
    title: `📞 ${r.name} is calling`,
    body: "Joined your HIVEMIND call. Tap to answer.",
    url: `/call/${room}?${q}`,
    tag: `call-${room}`,
    sticky: true,
    actions: [
      { action: "answer", title: "Answer" },
      { action: "decline", title: "Decline" },
    ],
  });
  return NextResponse.json({ rang: sent > 0 });
});

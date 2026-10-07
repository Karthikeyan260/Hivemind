import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { claimRing, getRoom } from "@/lib/call-rooms";
import { getScreenSettings } from "@/lib/call-screen";
import { db } from "@/lib/db";
import { notify } from "@/lib/push";

/**
 * Open to the invited guest (no password): rings the owner's devices when the guest joins a call link.
 * Only rooms the owner created in the last 24 h (or their permanent link) can ring, at most once every
 * 30 seconds. Also tells the guest's page whether HIVEMIND screens the call if nobody answers.
 */
export const POST = handle(async (req: Request) => {
  const { room, name } = await parseBody(req, z.object({ room: z.string().regex(/^[a-z0-9]{8,40}$/i), name: z.string().max(40).optional() }));
  const supabase = db();
  const known = await getRoom(supabase, room);
  if (!known) return NextResponse.json({ rang: false, screen: null });
  const settings = await getScreenSettings(supabase).catch(() => null);
  const screen = settings && settings.mode !== "off" ? { mode: settings.mode, wait_s: settings.wait_s } : null;
  const r = await claimRing(supabase, room);
  if (!r) return NextResponse.json({ rang: false, screen });
  // The permanent link: the caller types their own name (shown to the owner as given, untrusted).
  const who = (r.permanent ? name?.replace(/[^\p{L}\p{N} .'-]/gu, "").trim() : r.name) || "Someone";
  const q = new URLSearchParams({ host: "1", from: r.from, name: who, ...(r.to ? { to: r.to } : {}) });
  const sent = await notify(supabase, {
    title: `📞 ${who} is calling`,
    body: screen?.mode === "always" ? "HIVEMIND is answering for you. Tap to pick up yourself." : "Joined your HIVEMIND call. Tap to answer.",
    url: `/call/${room}?${q}`,
    tag: `call-${room}`,
    sticky: true,
    actions: [
      { action: "answer", title: "Answer" },
      { action: "decline", title: "Decline" },
    ],
  });
  return NextResponse.json({ rang: sent > 0, screen });
});

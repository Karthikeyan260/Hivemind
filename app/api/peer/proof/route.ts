import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { peerProof } from "@/lib/session";

/** Owner only (behind the password): signs a guest's challenge so the guest knows this is really the owner. */
export const POST = handle(async (req: Request) => {
  const { kind, room, nonce } = await parseBody(req, z.object({ kind: z.enum(["call", "draw"]), room: z.string().regex(/^[a-z0-9]{8,40}$/i), nonce: z.string().regex(/^[a-z0-9-]{16,64}$/i) }));
  return NextResponse.json({ proof: await peerProof(kind, room, nonce) });
});

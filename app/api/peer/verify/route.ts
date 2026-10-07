import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { peerProof, safeEqual } from "@/lib/session";

/** Open to guests: checks the host's answer to their challenge. Says only yes or no. */
export const POST = handle(async (req: Request) => {
  const { kind, room, nonce, proof } = await parseBody(
    req,
    z.object({ kind: z.enum(["call", "draw"]), room: z.string().regex(/^[a-z0-9]{8,40}$/i), nonce: z.string().regex(/^[a-z0-9-]{16,64}$/i), proof: z.string().max(128) }),
  );
  return NextResponse.json({ ok: safeEqual(proof, await peerProof(kind, room, nonce)) });
});

/** Browser side of the host check (see peerProof in lib/session.ts). */
export type PeerKind = "call" | "draw";

const post = (path: string, body: unknown) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Owner: answer a guest's challenge (needs the owner's session). */
export async function proveHost(kind: PeerKind, room: string, nonce: string): Promise<string | null> {
  const r = await post("/api/peer/proof", { kind, room, nonce }).catch(() => null);
  return r?.ok ? ((await r.json()) as { proof: string }).proof : null;
}

/** Guest: is this the owner's real browser? */
export async function checkHost(kind: PeerKind, room: string, nonce: string, proof: unknown): Promise<boolean> {
  if (typeof proof !== "string") return false;
  const r = await post("/api/peer/verify", { kind, room, nonce, proof }).catch(() => null);
  return !!r?.ok && !!((await r.json()) as { ok: boolean }).ok;
}

import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { readJSON, writeJSON } from "@/lib/private-store";

/**
 * Signing keys that are NOT the owner's password. Each one is 32 random bytes made the first time
 * it's needed and kept in the private bucket (an env var like SESSION_SECRET / PEER_SECRET wins if
 * set). Keeping them separate matters: a peer proof or a cookie must never let anyone test guesses
 * of APP_PASSWORD offline.
 */
export type SecretName = "session" | "peer";

const KEY = "auth/secrets";
const cache = new Map<SecretName, string>();

export async function getSecret(name: SecretName): Promise<string> {
  const env = process.env[`${name.toUpperCase()}_SECRET`];
  if (env && env.length >= 32) return env;
  const hit = cache.get(name);
  if (hit) return hit;
  const supabase = db();
  const stored = await readJSON<Partial<Record<SecretName, string>>>(supabase, KEY, {});
  if (!stored[name]) {
    await writeJSON(supabase, KEY, { ...stored, [name]: randomBytes(32).toString("hex") });
    // Two instances may race to create it: whoever wrote last wins, and everyone uses that one.
    Object.assign(stored, await readJSON<Partial<Record<SecretName, string>>>(supabase, KEY, {}));
  }
  const value = stored[name]!;
  cache.set(name, value);
  return value;
}

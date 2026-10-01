import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import webpush, { type PushSubscription } from "web-push";
import { readJSON, writeJSON } from "@/lib/private-store";

// Web Push: notifications on the owner's devices even when HIVEMIND is closed.
const KEY = "push-subscriptions";

export type Notice = {
  title: string;
  body: string;
  /** Page to open when tapped. */
  url?: string;
  /** Same tag replaces an older notification instead of stacking. */
  tag?: string;
  /** Keep it on screen until handled (calls). */
  sticky?: boolean;
  actions?: { action: string; title: string }[];
};

type Stored = PushSubscription & { device?: string; added?: string };

export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

function setup() {
  if (!pushConfigured()) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:owner@hivemind.local", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  return true;
}

export const listSubscriptions = (supabase: SupabaseClient) => readJSON<Stored[]>(supabase, KEY, []);

export async function addSubscription(supabase: SupabaseClient, sub: PushSubscription, device?: string) {
  const all = (await listSubscriptions(supabase)).filter((s) => s.endpoint !== sub.endpoint);
  all.push({ ...sub, device, added: new Date().toISOString() });
  await writeJSON(supabase, KEY, all.slice(-10));
  return all.length;
}

export async function removeSubscription(supabase: SupabaseClient, endpoint: string) {
  const all = await listSubscriptions(supabase);
  await writeJSON(supabase, KEY, all.filter((s) => s.endpoint !== endpoint));
}

/** Sends to every subscribed device; drops devices whose subscription has expired. Returns how many got it. */
export async function notify(supabase: SupabaseClient, n: Notice) {
  if (!setup()) return 0;
  const subs = await listSubscriptions(supabase);
  if (!subs.length) return 0;
  const gone: string[] = [];
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s, JSON.stringify(n), { TTL: n.sticky ? 60 : 3600, urgency: n.sticky ? "high" : "normal" });
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(s.endpoint);
        else console.warn("push failed:", code, err instanceof Error ? err.message.slice(0, 120) : err);
      }
    }),
  );
  if (gone.length) await writeJSON(supabase, KEY, subs.filter((s) => !gone.includes(s.endpoint)));
  return sent;
}

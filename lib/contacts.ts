import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { searchKnowledge } from "@/lib/rag/retrieval";

/** Indian mobile/landline in any common spelling ("98765 43210", "+91-98765-43210", "098765…") → "+919876543210". */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length !== 10 || !/^[2-9]/.test(d)) return null;
  return `+91${d}`;
}

/** Phone-number-looking runs inside free text (10-13 digits, optional +91 and separators). */
const PHONE_RE = /(?:\+?91[\s-]?|0)?[2-9]\d{2,4}[\s-]?\d{2,5}[\s-]?\d{2,5}/g;

export const pretty = (p: string) => `+91 ${p.slice(3, 8)} ${p.slice(8)}`;

export type Contact = { name: string; phone: string; from: string; memory_id: string };

/**
 * Finds someone's number in the brain: memories/notes that mention the name and contain a phone number.
 * Contacts are ordinary memories ("Arif's phone number is …"), so anything you've told HIVEMIND counts.
 */
export async function findContacts(supabase: SupabaseClient, who: string): Promise<Contact[]> {
  const name = who.trim();
  const words = name.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const hits = await searchKnowledge(supabase, `${name} phone number contact`, { limit: 12, minSimilarity: 0.25 });
  const out: Contact[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const text = `${h.title}\n${h.content}`;
    const lower = text.toLowerCase();
    if (words.length && !words.some((w) => lower.includes(w))) continue;
    for (const m of text.matchAll(PHONE_RE)) {
      const phone = normalizePhone(m[0]);
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      out.push({ name: name || h.title, phone, from: h.title, memory_id: h.parent_id });
    }
  }
  return out;
}

export const telLink = (phone: string) => `tel:${phone}`;
export const smsLink = (phone: string, text: string) => `sms:${phone}${text ? `?body=${encodeURIComponent(text)}` : ""}`;
export const whatsappLink = (phone: string, text: string) => `https://wa.me/${phone.slice(1)}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateWithFallback } from "@/lib/ai/providers";
import { HttpError } from "@/lib/api";
import { findContacts, whatsappLink } from "@/lib/contacts";
import { readJSON, writeJSON } from "@/lib/private-store";
import { notify } from "@/lib/push";
import { localParts } from "@/lib/reminders";

/** Birthdays and anniversaries: alerts 1 week before, the evening before, and on the morning of the day. */
export type Birthday = {
  id: string;
  name: string;
  month: number;
  day: number;
  /** Optional: lets HIVEMIND say "turning 25". */
  year?: number;
  kind: "birthday" | "anniversary";
  relation?: string;
  /** Alert stage → year it was sent, so each fires once a year. */
  sent?: { week?: number; eve?: number; day?: number };
};

const KEY = "birthdays";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const listBirthdays = (supabase: SupabaseClient) => readJSON<Birthday[]>(supabase, KEY, []);
const save = (supabase: SupabaseClient, all: Birthday[]) => writeJSON(supabase, KEY, all);

export const dateLabel = (b: Pick<Birthday, "month" | "day">) => `${b.day} ${MONTHS[b.month - 1]}`;

function validDate(month: number, day: number) {
  if (!(month >= 1 && month <= 12 && day >= 1)) return false;
  return day <= new Date(Date.UTC(2024, month, 0)).getUTCDate(); // 2024: leap year, so 29 Feb is allowed
}

export async function addBirthday(supabase: SupabaseClient, b: Omit<Birthday, "id" | "sent">) {
  if (!b.name.trim()) throw new HttpError(400, "Whose birthday is it?");
  if (!validDate(b.month, b.day)) throw new HttpError(400, "That date doesn't exist.");
  const all = await listBirthdays(supabase);
  const same = all.find((x) => x.name.toLowerCase() === b.name.trim().toLowerCase() && x.kind === b.kind);
  const entry: Birthday = { ...b, name: b.name.trim(), id: same?.id ?? crypto.randomUUID().slice(0, 12), sent: same?.sent };
  await save(supabase, [...all.filter((x) => x.id !== entry.id), entry]);
  return entry;
}

export async function removeBirthday(supabase: SupabaseClient, idOrName: string, exact = false) {
  const all = await listBirthdays(supabase);
  const q = idOrName.toLowerCase();
  // API routes pass exact: a URL must only ever delete the entry with that id.
  const hit = exact ? all.find((x) => x.id === idOrName) : (all.find((x) => x.id === idOrName) ?? all.find((x) => x.name.toLowerCase() === q) ?? all.find((x) => x.name.toLowerCase().includes(q)));
  if (!hit) return null;
  await save(supabase, all.filter((x) => x.id !== hit.id));
  return hit;
}

/** Days from `today` to the next occurrence (0 = today). 29 Feb falls on 28 Feb in other years. */
function daysUntil(b: Birthday, today: string) {
  const [y] = today.split("-").map(Number);
  for (const year of [y, y + 1]) {
    const leap = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1;
    const day = b.month === 2 && b.day === 29 && !leap ? 28 : b.day;
    const d = `${year}-${String(b.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const diff = Math.round((Date.UTC(year, b.month - 1, day) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    if (diff >= 0) return { days: diff, date: d, year };
  }
  return { days: 366, date: today, year: y + 1 };
}

export type Upcoming = Birthday & { days: number; date: string; turning: number | null; label: string };

export async function upcomingBirthdays(supabase: SupabaseClient, within = 60): Promise<Upcoming[]> {
  const today = localParts().date;
  return (await listBirthdays(supabase))
    .map((b) => {
      const n = daysUntil(b, today);
      return { ...b, days: n.days, date: n.date, turning: b.year ? n.year - b.year : null, label: dateLabel(b) };
    })
    .filter((b) => b.days <= within)
    .sort((a, b) => a.days - b.days);
}

const what = (b: Birthday) => (b.kind === "anniversary" ? "anniversary" : "birthday");

/** A short, warm wish in the owner's voice, plus a WhatsApp link when the person's number is known. */
export async function birthdayWish(supabase: SupabaseClient, id: string) {
  const b = (await listBirthdays(supabase)).find((x) => x.id === id);
  if (!b) throw new HttpError(404, "Not found");
  const turning = b.year ? localParts().year - b.year : null;
  let text = `Happy ${what(b)}, ${b.name}! 🎉 Wishing you a wonderful year ahead.`;
  try {
    const r = await generateWithFallback(
      [
        {
          role: "user",
          content: `Write a short, warm WhatsApp ${what(b)} wish (2-3 sentences, 1-2 emojis, casual Indian English, no hashtags, no quotes) from me to ${b.name}${b.relation ? ` (my ${b.relation})` : ""}${turning && b.kind === "birthday" ? `, who turns ${turning}` : ""}. Just the message.`,
        },
      ],
      { temperature: 0.8, maxTokens: 150 },
    );
    if (r.text.trim()) text = r.text.trim().replace(/^["']|["']$/g, "");
  } catch {}
  const contact = (await findContacts(supabase, b.name).catch(() => []))[0];
  return { name: b.name, text, whatsapp: contact ? whatsappLink(contact.phone, text) : null, phone: contact?.phone ?? null };
}

/** Called by the 5-minute cron: week-before (morning), eve (evening) and on-the-day (morning) alerts. */
export async function runBirthdayAlerts(supabase: SupabaseClient, now = new Date()) {
  const lp = localParts(now);
  const morning = lp.hour >= 8 && lp.hour < 12;
  const evening = lp.hour >= 19 && lp.hour < 22;
  if (!morning && !evening) return 0;
  const all = await listBirthdays(supabase);
  let sent = 0;
  for (const b of all) {
    const n = daysUntil(b, lp.date);
    b.sent ??= {};
    const turning = b.year && b.kind === "birthday" ? ` (turning ${n.year - b.year})` : "";
    const stage = morning && n.days === 0 ? "day" : morning && n.days === 7 ? "week" : evening && n.days === 1 ? "eve" : null;
    if (!stage || b.sent[stage] === n.year) continue;
    const notice =
      stage === "day"
        ? { title: `🎂 Today is ${b.name}'s ${what(b)}${turning}`, body: "Tap to send a wish on WhatsApp.", url: `/habits?wish=${b.id}`, tag: `bday-${b.id}` }
        : stage === "eve"
          ? { title: `🎁 Tomorrow is ${b.name}'s ${what(b)}`, body: `${dateLabel(b)}${turning}. Don't forget!`, url: "/habits", tag: `bday-${b.id}` }
          : { title: `📅 ${b.name}'s ${what(b)} is in a week`, body: `${dateLabel(b)}${turning}. Time to plan a gift?`, url: "/habits", tag: `bday-${b.id}` };
    if ((await notify(supabase, notice)) > 0) {
      b.sent[stage] = n.year;
      sent++;
    }
  }
  if (sent) await save(supabase, all);
  return sent;
}

/** "🎂 Arif's birthday today" lines for the morning brief. */
export async function birthdaysToday(supabase: SupabaseClient) {
  return (await upcomingBirthdays(supabase, 0)).map((b) => `🎂 ${b.name}'s ${what(b)}`);
}

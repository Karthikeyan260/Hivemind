import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError, HttpError } from "@/lib/api";
import { createNote } from "@/lib/knowledge";

// Reminders are notes tagged "reminder" whose metadata.reminder holds the schedule, so they live in
// the brain (searchable, filed into projects) without a separate table.
export const HOME_TZ = process.env.HOME_TZ || "Asia/Kolkata";
const REMINDER_TAG = "reminder";
/** Alerts fire this many minutes before the time (all-day items alert at 9:00). */
const DEFAULT_BEFORE_MIN = 15;

export type ReminderMeta = { due_at: string; all_day: boolean; remind_before_min: number; status: "pending" | "done"; alerted_at: string | null };
export type Reminder = { id: string; title: string; details: string; due_at: string; all_day: boolean; status: ReminderMeta["status"]; when: string };

/** Minutes the zone is ahead of UTC at that instant. */
function tzOffsetMin(d: Date, tz = HOME_TZ) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - d.getTime()) / 60000);
}

/** Start of the local day containing `d`, shifted by `addDays`, as a UTC instant. */
export function localDayStart(d: Date, addDays = 0, tz = HOME_TZ) {
  const [y, m, day] = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d).split("-").map(Number);
  const guess = Date.UTC(y, m - 1, day + addDays);
  return new Date(guess - tzOffsetMin(new Date(guess), tz) * 60000);
}

export function formatWhen(dueAt: string, allDay: boolean, tz = HOME_TZ) {
  const d = new Date(dueAt);
  const day = new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);
  if (allDay) return `${day} (all day)`;
  return `${day}, ${new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(d)}`;
}

/** "Wed, 30 Sep 2026, 10:15 am (Asia/Kolkata, UTC+05:30)": what agents need to resolve "tomorrow at 3". */
export function nowForPrompt(tz = HOME_TZ) {
  const now = new Date();
  const off = tzOffsetMin(now, tz);
  const sign = off >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const mm = String(Math.abs(off) % 60).padStart(2, "0");
  const txt = new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(now);
  return `${txt} (${tz}, UTC${sign}${hh}:${mm})`;
}

type Row = { id: string; title: string; content: string; metadata: { reminder?: ReminderMeta } & Record<string, unknown> };

function toReminder(r: Row): Reminder {
  const m = r.metadata.reminder!;
  const details = r.content.split("\n").filter((l) => !/^(Reminder|When):/.test(l)).join("\n").trim();
  return { id: r.id, title: r.title, details, due_at: m.due_at, all_day: m.all_day, status: m.status, when: formatWhen(m.due_at, m.all_day) };
}

export async function createReminder(
  supabase: SupabaseClient,
  input: { title: string; when: string; all_day?: boolean; details?: string; remind_before_min?: number; project_id?: string | null },
) {
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new HttpError(400, "A reminder needs a title.");
  let due = new Date(input.when);
  if (Number.isNaN(due.getTime())) throw new HttpError(400, `I couldn't read the time “${input.when}”.`);
  const allDay = !!input.all_day;
  // All-day items surface at 9:00 local time that day.
  if (allDay) due = new Date(localDayStart(due).getTime() + 9 * 3600_000);

  const meta: ReminderMeta = {
    due_at: due.toISOString(),
    all_day: allDay,
    remind_before_min: allDay ? 0 : (input.remind_before_min ?? DEFAULT_BEFORE_MIN),
    status: "pending",
    alerted_at: null,
  };
  const content = [`Reminder: ${title}`, `When: ${formatWhen(meta.due_at, allDay)}`, input.details?.trim() ?? ""].filter(Boolean).join("\n");
  const note = await createNote(supabase, { title, content, project_id: input.project_id ?? undefined, tags: [REMINDER_TAG] });
  const { data: cur } = await supabase.from("notes").select("metadata").eq("id", note.id).single();
  const { error } = await supabase
    .from("notes")
    .update({ metadata: { ...((cur?.metadata as object) ?? {}), reminder: meta } })
    .eq("id", note.id);
  dbError(error);
  return toReminder({ id: note.id, title: note.title, content, metadata: { reminder: meta } });
}

async function query(supabase: SupabaseClient, from: Date, to: Date, status?: ReminderMeta["status"]) {
  let q = supabase
    .from("notes")
    .select("id, title, content, metadata")
    .contains("tags", JSON.stringify([REMINDER_TAG]))
    .gte("metadata->reminder->>due_at", from.toISOString())
    .lt("metadata->reminder->>due_at", to.toISOString())
    .order("metadata->reminder->>due_at", { ascending: true });
  if (status) q = q.eq("metadata->reminder->>status", status);
  const { data, error } = await q;
  dbError(error);
  return ((data ?? []) as Row[]).filter((r) => r.metadata?.reminder);
}

/** Overdue (last 7 days, still pending), today, tomorrow and later (within `days`). */
export async function agenda(supabase: SupabaseClient, days = 7) {
  const now = new Date();
  const today = localDayStart(now);
  const tomorrow = localDayStart(now, 1);
  const dayAfter = localDayStart(now, 2);
  const end = localDayStart(now, Math.max(2, days));
  const [overdue, upcoming] = await Promise.all([query(supabase, localDayStart(now, -7), today, "pending"), query(supabase, today, end)]);
  const items = upcoming.map(toReminder);
  const at = (r: Reminder) => new Date(r.due_at).getTime();
  return {
    now: now.toISOString(),
    timezone: HOME_TZ,
    overdue: overdue.map(toReminder),
    today: items.filter((r) => at(r) < tomorrow.getTime()),
    tomorrow: items.filter((r) => at(r) >= tomorrow.getTime() && at(r) < dayAfter.getTime()),
    later: items.filter((r) => at(r) >= dayAfter.getTime()),
  };
}

/** Reminders whose alert time has arrived and that haven't been shown yet; marks them alerted. */
export async function dueAlerts(supabase: SupabaseClient) {
  const now = Date.now();
  const rows = await query(supabase, new Date(now - 6 * 3600_000), new Date(now + 24 * 3600_000), "pending");
  const due = rows.filter((r) => {
    const m = r.metadata.reminder!;
    return !m.alerted_at && new Date(m.due_at).getTime() - m.remind_before_min * 60_000 <= now;
  });
  await Promise.all(
    due.map((r) =>
      supabase
        .from("notes")
        .update({ metadata: { ...r.metadata, reminder: { ...r.metadata.reminder!, alerted_at: new Date(now).toISOString() } } })
        .eq("id", r.id),
    ),
  );
  return due.map(toReminder);
}

export async function setReminderStatus(supabase: SupabaseClient, id: string, status: ReminderMeta["status"]) {
  const { data, error } = await supabase.from("notes").select("id, title, content, metadata").eq("id", id).contains("tags", JSON.stringify([REMINDER_TAG])).maybeSingle();
  dbError(error);
  const row = data as Row | null;
  if (!row?.metadata?.reminder) throw new HttpError(404, "Reminder not found");
  const reminder = { ...row.metadata.reminder, status };
  const { error: e } = await supabase.from("notes").update({ metadata: { ...row.metadata, reminder } }).eq("id", id);
  dbError(e);
  return toReminder({ ...row, metadata: { ...row.metadata, reminder } });
}

/** Finds the pending reminder that best matches a phrase (for "mark the dentist one done"). */
export async function findReminder(supabase: SupabaseClient, phrase: string) {
  const a = await agenda(supabase, 30);
  const all = [...a.overdue, ...a.today, ...a.tomorrow, ...a.later].filter((r) => r.status === "pending");
  const words = phrase.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const score = (r: Reminder) => words.filter((w) => `${r.title} ${r.details}`.toLowerCase().includes(w)).length;
  const best = all.map((r) => ({ r, s: score(r) })).sort((x, y) => y.s - x.s)[0];
  return best && best.s > 0 ? best.r : null;
}

/** One line per item for prompts: "today: Client meeting (Wed, 30 Sep, 3:00 pm)". */
export function agendaForPrompt(a: Awaited<ReturnType<typeof agenda>>) {
  const line = (label: string, list: Reminder[]) => (list.length ? `${label}: ${list.map((r) => `${r.title} (${r.when}${r.status === "done" ? ", done" : ""})`).join("; ")}` : "");
  return [line("Overdue", a.overdue), line("Today", a.today), line("Tomorrow", a.tomorrow)].filter(Boolean).join("\n") || "Nothing scheduled today or tomorrow.";
}

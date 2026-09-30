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

/** Start of a calendar day (y-m-d in the home zone) as a UTC instant. */
function localDateStart(y: number, m: number, d: number, tz = HOME_TZ) {
  const guess = Date.UTC(y, m - 1, d);
  return new Date(guess - tzOffsetMin(new Date(guess), tz) * 60000);
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function parseTime(raw?: string) {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t === "noon") return { h: 12, m: 0 };
  if (t === "midnight") return { h: 0, m: 0 };
  const m = t.match(/^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) throw new HttpError(400, `I couldn't read the time “${raw}”.`);
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.replace(/\./g, "");
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) throw new HttpError(400, `I couldn't read the time “${raw}”.`);
  return { h, m: min };
}

export type WhenInput = { date?: string; time?: string; in_minutes?: number; when?: string; all_day?: boolean };

/**
 * Turns what the model understood ("tomorrow" + "15:00", "friday", "2026-10-02", "in 90 minutes")
 * into an exact instant in the owner's zone. The server does the calendar maths so a model that
 * gets the year or UTC offset wrong can't misplace a meeting.
 */
export function resolveWhen(input: WhenInput, now = new Date()): { due: Date; allDay: boolean } {
  if (input.in_minutes && input.in_minutes > 0) return { due: new Date(now.getTime() + input.in_minutes * 60_000), allDay: false };
  const [cy] = new Intl.DateTimeFormat("en-CA", { timeZone: HOME_TZ }).format(now).split("-").map(Number);
  let dayStart: Date;
  let time = parseTime(input.time);

  if (input.when && !input.date) {
    // Legacy ISO date-time: keep its wall-clock time but never trust a past year.
    const iso = input.when.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!iso) throw new HttpError(400, `I couldn't read the date “${input.when}”.`);
    dayStart = localDateStart(Math.max(Number(iso[1]), cy), Number(iso[2]), Number(iso[3]));
    if (iso[4] && !input.all_day) time ??= { h: Number(iso[4]), m: Number(iso[5]) };
  } else {
    const d = (input.date ?? "today").trim().toLowerCase();
    const ymd = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const inDays = d.match(/^in (\d+) days?$/);
    const wd = WEEKDAYS.findIndex((w) => d.includes(w));
    if (!d || d === "today" || d === "tonight") dayStart = localDayStart(now);
    else if (d === "tomorrow") dayStart = localDayStart(now, 1);
    else if (d.includes("day after tomorrow")) dayStart = localDayStart(now, 2);
    else if (inDays) dayStart = localDayStart(now, Number(inDays[1]));
    else if (wd >= 0) {
      const cur = WEEKDAYS.indexOf(new Intl.DateTimeFormat("en-US", { timeZone: HOME_TZ, weekday: "long" }).format(now).toLowerCase());
      let diff = (wd - cur + 7) % 7;
      if (diff === 0 && d.startsWith("next")) diff = 7;
      dayStart = localDayStart(now, diff);
    } else if (ymd) {
      const [y, m, day] = [Math.max(Number(ymd[1]), cy), Number(ymd[2]), Number(ymd[3])];
      dayStart = localDateStart(y, m, day);
      // A month-day already behind us this year means next year.
      if (dayStart < localDayStart(now)) dayStart = localDateStart(y + 1, m, day);
    } else throw new HttpError(400, `I couldn't read the date “${input.date}”. Use today, tomorrow, a weekday, or YYYY-MM-DD.`);
  }

  if (input.all_day || !time) return { due: new Date(dayStart.getTime() + 9 * 3600_000), allDay: true };
  return { due: new Date(dayStart.getTime() + (time.h * 60 + time.m) * 60_000), allDay: false };
}

export async function createReminder(
  supabase: SupabaseClient,
  input: WhenInput & { title: string; details?: string; remind_before_min?: number; project_id?: string | null },
) {
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new HttpError(400, "A reminder needs a title.");
  const { due, allDay } = resolveWhen(input);
  if (!allDay && due.getTime() < Date.now() - 10 * 60_000) throw new HttpError(400, `That time (${formatWhen(due.toISOString(), false)}) has already passed.`);

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
export async function findReminder(supabase: SupabaseClient, phrase: string, opts: { includeDone?: boolean } = {}) {
  const a = await agenda(supabase, 30);
  const p = phrase.toLowerCase();
  const pool = [...a.overdue, ...a.today, ...a.tomorrow, ...a.later].filter((r) => opts.includeDone || r.status === "pending");
  // "the meeting tomorrow" should match by day as well as by words.
  const day = (r: Reminder) => (/\btoday\b/.test(p) && a.today.includes(r)) || (/\btomorrow\b/.test(p) && a.tomorrow.includes(r));
  const words = p.split(/\W+/).filter((w) => w.length > 2 && !["today", "tomorrow", "the", "my", "and"].includes(w));
  const score = (r: Reminder) => words.filter((w) => `${r.title} ${r.details}`.toLowerCase().includes(w)).length + (day(r) ? 1 : 0);
  const best = pool.map((r) => ({ r, s: score(r) })).sort((x, y) => y.s - x.s)[0];
  return best && best.s > 0 ? best.r : null;
}

/** Cancelling removes the reminder (it's a note) from the brain entirely. */
export async function deleteReminder(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("notes").delete().eq("id", id).contains("tags", JSON.stringify([REMINDER_TAG]));
  dbError(error);
}

export async function rescheduleReminder(supabase: SupabaseClient, id: string, when: WhenInput) {
  const { data, error } = await supabase.from("notes").select("id, title, content, metadata").eq("id", id).contains("tags", JSON.stringify([REMINDER_TAG])).maybeSingle();
  dbError(error);
  const row = data as Row | null;
  if (!row?.metadata?.reminder) throw new HttpError(404, "Reminder not found");
  const { due, allDay } = resolveWhen(when);
  if (!allDay && due.getTime() < Date.now() - 10 * 60_000) throw new HttpError(400, `That time (${formatWhen(due.toISOString(), false)}) has already passed.`);
  const reminder: ReminderMeta = {
    ...row.metadata.reminder,
    due_at: due.toISOString(),
    all_day: allDay,
    remind_before_min: allDay ? 0 : row.metadata.reminder.remind_before_min || DEFAULT_BEFORE_MIN,
    status: "pending",
    alerted_at: null,
  };
  const content = row.content.replace(/^When: .*$/m, `When: ${formatWhen(reminder.due_at, allDay)}`);
  const { error: e } = await supabase.from("notes").update({ content, metadata: { ...row.metadata, reminder } }).eq("id", id);
  dbError(e);
  return toReminder({ ...row, content, metadata: { ...row.metadata, reminder } });
}

/** One entry point for "cancel / done / move <which>" from chat or voice. */
export async function actOnReminder(supabase: SupabaseClient, action: "cancel" | "complete" | "reschedule", which: string, when?: WhenInput) {
  const r = await findReminder(supabase, which, { includeDone: action === "cancel" });
  if (!r) return { error: `No reminder matching "${which}".` };
  if (action === "cancel") {
    await deleteReminder(supabase, r.id);
    return { cancelled: true, removed: true, title: r.title, was: r.when };
  }
  if (action === "complete") {
    await setReminderStatus(supabase, r.id, "done");
    return { done: true, title: r.title, when: r.when };
  }
  if (!when || (!when.date && !when.time && !when.in_minutes && !when.when)) return { error: "Need the new date/time to reschedule." };
  // "move it to 6 pm" keeps the same day.
  const sameDay = new Intl.DateTimeFormat("en-CA", { timeZone: HOME_TZ }).format(new Date(r.due_at));
  const moved = await rescheduleReminder(supabase, r.id, { ...when, date: when.date ?? (when.in_minutes || when.when ? undefined : sameDay) });
  return { rescheduled: true, title: moved.title, from: r.when, to: moved.when };
}

/** One line per item for prompts: "today: Client meeting (Wed, 30 Sep, 3:00 pm)". */
export function agendaForPrompt(a: Awaited<ReturnType<typeof agenda>>) {
  const line = (label: string, list: Reminder[]) => (list.length ? `${label}: ${list.map((r) => `${r.title} (${r.when}${r.status === "done" ? ", done" : ""})`).join("; ")}` : "");
  return [line("Overdue", a.overdue), line("Today", a.today), line("Tomorrow", a.tomorrow)].filter(Boolean).join("\n") || "Nothing scheduled today or tomorrow.";
}

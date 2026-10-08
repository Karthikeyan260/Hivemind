import "server-only";
import { addBirthday, birthdayWish, dateLabel, listBirthdays, removeBirthday, upcomingBirthdays } from "@/lib/birthdays";
import { addHabit, checkHabit, everyHours, habitsWithStats, removeHabit, snoozeHabit } from "@/lib/habits";
import { actOnReminder, agenda, createReminder, nowForPrompt } from "@/lib/reminders";
import { obj, S, str } from "./shared";
import type { Tool } from "../types";

/** Birthdays, habits and reminders. */
export const schedule: Record<string, Tool> = {
  /* ───── birthdays & anniversaries ───── */
  add_birthday: {
    name: "add_birthday",
    description: "Save someone's birthday or anniversary ('Arif's birthday is 12 March', 'Amma and Appa's anniversary is 5 June'). Alerts come 1 week before, the evening before and on the morning of the day.",
    parameters: obj(
      {
        name: S,
        month: { type: "number", description: "1-12" },
        day: { type: "number", description: "1-31" },
        year: { type: "number", description: "Birth/wedding year if known (for 'turning 25')" },
        kind: { type: "string", enum: ["birthday", "anniversary"] },
        relation: { type: "string", description: "friend, mother, colleague…" },
      },
      ["name", "month", "day"],
    ),
    async run(args, ctx) {
      const b = await addBirthday(ctx.supabase, {
        name: str(args.name),
        month: Number(args.month),
        day: Number(args.day),
        year: args.year ? Number(args.year) : undefined,
        kind: str(args.kind) === "anniversary" ? "anniversary" : "birthday",
        relation: str(args.relation) || undefined,
      });
      ctx.actions.push({ label: "Birthdays", href: "/habits" });
      return { saved: true, name: b.name, date: dateLabel(b), kind: b.kind };
    },
  },
  upcoming_birthdays: {
    name: "upcoming_birthdays",
    description:
      "Birthdays and anniversaries coming up ('whose birthday is next?', 'any birthdays this month?'). Always returns the next ones even if they're months away; pass days only for a specific window like 'this month'.",
    parameters: obj({ days: { type: "number", description: "Only for an explicit window ('this week' = 7, 'this month' = 30). Omit for 'next'." } }),
    async run(args, ctx) {
      const all = await upcomingBirthdays(ctx.supabase, 366);
      const shape = (b: (typeof all)[number]) => ({ name: b.name, kind: b.kind, relation: b.relation, date: b.label, in_days: b.days, turning: b.turning });
      if (!all.length) return { upcoming: [], note: "No birthdays saved yet." };
      const window = Number(args.days) || 0;
      if (!window) return { next: all.slice(0, 3).map(shape) };
      const inWindow = all.filter((b) => b.days <= window);
      // Nothing in that window: still say who's next, so the answer is useful.
      return inWindow.length ? { upcoming: inWindow.map(shape) } : { upcoming: [], next_after_window: all.slice(0, 2).map(shape) };
    },
  },
  remove_birthday: {
    name: "remove_birthday",
    description: "Remove a saved birthday/anniversary.",
    parameters: obj({ which: S }, ["which"]),
    async run(args, ctx) {
      const b = await removeBirthday(ctx.supabase, str(args.which));
      return b ? { removed: true, name: b.name } : { error: `No birthday saved for "${str(args.which)}".` };
    },
  },
  birthday_wish: {
    name: "birthday_wish",
    description: "Write a personal birthday/anniversary wish for someone and show a WhatsApp button with it ready to send.",
    parameters: obj({ who: S }, ["who"]),
    async run(args, ctx) {
      const q = str(args.who).toLowerCase();
      const all = await listBirthdays(ctx.supabase);
      const b = all.find((x) => x.name.toLowerCase() === q) ?? all.find((x) => x.name.toLowerCase().includes(q));
      if (!b) return { error: `I don't have ${str(args.who)}'s birthday saved. Tell me the date first.` };
      const w = await birthdayWish(ctx.supabase, b.id);
      if (w.whatsapp) ctx.actions.push({ label: `WhatsApp ${w.name}`, href: w.whatsapp });
      return { wish: w.text, whatsapp_button: !!w.whatsapp, note: w.whatsapp ? undefined : `No number saved for ${w.name}; share the wish yourself or save their number.` };
    },
  },

  /* ───── habits ───── */
  add_habit: {
    name: "add_habit",
    description:
      "Start tracking a habit with reminders ('exercise every day at 7 am', 'read 20 minutes on weekdays at 9 pm', 'drink water every 2 hours'). Times are local HH:MM. Changing an existing habit's time uses the same tool.",
    parameters: obj(
      {
        name: S,
        emoji: { type: "string", description: "One fitting emoji" },
        times: { type: "array", items: { type: "string" }, description: 'Local times, e.g. ["07:00"]' },
        every_hours: { type: "number", description: "For 'every N hours' habits" },
        from: { type: "string", description: "Start time for every_hours (default 09:00)" },
        to: { type: "string", description: "End time for every_hours (default 21:00)" },
        days: { type: "string", description: "'daily' (default), 'weekdays', 'weekends', or e.g. 'mon,wed,fri'" },
      },
      ["name"],
    ),
    async run(args, ctx) {
      const d = str(args.days).toLowerCase();
      const names = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      const days = !d || d === "daily" || d === "every day" ? undefined : d.includes("weekday") ? [1, 2, 3, 4, 5] : d.includes("weekend") ? [0, 6] : names.map((n, i) => (d.includes(n) ? i : -1)).filter((i) => i >= 0);
      const times = args.every_hours ? everyHours(Number(args.every_hours), str(args.from) || undefined, str(args.to) || undefined) : Array.isArray(args.times) ? (args.times as unknown[]).map(String) : [];
      if (!times.length) return { error: "What time should I remind you? (e.g. 7 am)" };
      const h = await addHabit(ctx.supabase, { name: str(args.name), emoji: str(args.emoji) || undefined, times, days });
      ctx.actions.push({ label: "Habits", href: "/habits" });
      return { tracking: h.name, emoji: h.emoji, times: h.times, days: h.days.length === 7 ? "daily" : h.days.map((i) => names[i]).join(", ") };
    },
  },
  log_habit: {
    name: "log_habit",
    description: "Mark a habit done for today ('I did my exercise', 'drank water', 'done reading'). undo=true un-marks it.",
    parameters: obj({ which: S, undo: { type: "boolean" } }, ["which"]),
    async run(args, ctx) {
      const r = await checkHabit(ctx.supabase, str(args.which), { done: args.undo !== true });
      ctx.changed = true;
      return { habit: r.name, done: r.done, streak: r.streak, best: r.best };
    },
  },
  habits_status: {
    name: "habits_status",
    description: "How the owner's habits are going: what's done today, streaks, best streaks and the last-30-day rate.",
    parameters: obj({}),
    async run(_args, ctx) {
      const all = await habitsWithStats(ctx.supabase);
      if (!all.length) return { habits: [], note: "No habits tracked yet." };
      return { habits: all.map((h) => ({ name: h.name, times: h.times, due_today: h.dueToday, done_today: h.doneToday, streak: h.streak, best: h.best, rate_30d_pct: h.rate })) };
    },
  },
  remove_habit: {
    name: "remove_habit",
    description: "Stop tracking a habit (deletes it and its history).",
    parameters: obj({ which: S }, ["which"]),
    async run(args, ctx) {
      const h = await removeHabit(ctx.supabase, str(args.which));
      return h ? { removed: true, habit: h.name } : { error: `No habit called "${str(args.which)}".` };
    },
  },
  snooze_habit: {
    name: "snooze_habit",
    description: "Snooze a habit's reminder for a while ('remind me about water in an hour', 'snooze exercise').",
    parameters: obj({ which: S, minutes: { type: "number", description: "Default 30" } }, ["which"]),
    async run(args, ctx) {
      const h = await snoozeHabit(ctx.supabase, str(args.which), Number(args.minutes) || 30);
      return h ? { snoozed: true, habit: h.name, minutes: Number(args.minutes) || 30 } : { error: `No habit called "${str(args.which)}".` };
    },
  },

  /* ───── scheduler ───── */
  create_reminder: {
    name: "create_reminder",
    description:
      "Schedule a reminder / meeting / deadline. 'date' is \"today\", \"tomorrow\", a weekday (\"friday\", \"next monday\"), \"in 3 days\", or YYYY-MM-DD. 'time' is local clock time like \"15:00\" or \"3 pm\" (omit for all-day). For \"in 2 hours\" use in_minutes instead. The server works out the exact moment; never compute UTC or years yourself.",
    parameters: obj({ title: S, date: S, time: S, in_minutes: { type: "number" }, details: S, remind_before_min: { type: "number" } }, ["title"]),
    async run(args, ctx) {
      const r = await createReminder(ctx.supabase, {
        title: str(args.title),
        date: str(args.date) || undefined,
        time: str(args.time) || undefined,
        in_minutes: args.in_minutes == null ? undefined : Number(args.in_minutes),
        details: str(args.details) || undefined,
        remind_before_min: args.remind_before_min == null ? undefined : Number(args.remind_before_min),
        project_id: ctx.projectId,
      });
      ctx.changed = true;
      ctx.actions.push({ label: "Open reminder", href: `/notes?open=${r.id}` });
      return { scheduled: true, title: r.title, when: r.when, alert: r.all_day ? "on the morning of that day" : "15 minutes before, in HIVEMIND" };
    },
  },
  list_reminders: {
    name: "list_reminders",
    description: "The owner's agenda: overdue, today, tomorrow and later reminders.",
    parameters: obj({ days: { type: "number" } }),
    async run(args, ctx) {
      const a = await agenda(ctx.supabase, Math.min(Number(args.days) || 7, 60));
      const pick = (list: typeof a.today) => list.map((r) => ({ title: r.title, when: r.when, status: r.status, details: r.details || undefined }));
      return { now: nowForPrompt(), overdue: pick(a.overdue), today: pick(a.today), tomorrow: pick(a.tomorrow), later: pick(a.later) };
    },
  },
  complete_reminder: {
    name: "complete_reminder",
    description:
      "Mark a reminder as DONE, only when the owner says they finished it ('I did it', 'mark X done'). NOT for cancelling. 'which' identifies it (words from the title and/or 'today'/'tomorrow').",
    parameters: obj({ which: S }, ["which"]),
    async run(args, ctx) {
      const r = await actOnReminder(ctx.supabase, "complete", str(args.which));
      if (!r.error) ctx.changed = true;
      return r;
    },
  },
  cancel_reminder: {
    name: "cancel_reminder",
    description:
      "Cancel / delete / remove a reminder or meeting ('cancel tomorrow's meeting', 'the call is off'). Removes it from the agenda and notes. 'which' identifies it (words from the title and/or 'today'/'tomorrow').",
    parameters: obj({ which: S }, ["which"]),
    async run(args, ctx) {
      const r = await actOnReminder(ctx.supabase, "cancel", str(args.which));
      if (!r.error) ctx.changed = true;
      return r;
    },
  },
  reschedule_reminder: {
    name: "reschedule_reminder",
    description:
      "Move a reminder/meeting to a new date and/or time ('move the meeting to 4 pm', 'push it to Friday'). Give only what changes: time alone keeps the same day. 'date' is \"today\", \"tomorrow\", a weekday (\"friday\", \"next monday\"), \"in 3 days\", or YYYY-MM-DD. 'time' is local clock time like \"15:00\" or \"3 pm\" (omit for all-day). For \"in 2 hours\" use in_minutes instead. The server works out the exact moment; never compute UTC or years yourself.",
    parameters: obj({ which: S, date: S, time: S, in_minutes: { type: "number" } }, ["which"]),
    async run(args, ctx) {
      const r = await actOnReminder(ctx.supabase, "reschedule", str(args.which), {
        date: str(args.date) || undefined,
        time: str(args.time) || undefined,
        in_minutes: args.in_minutes == null ? undefined : Number(args.in_minutes),
      });
      if (!r.error) ctx.changed = true;
      return r;
    },
  },
};

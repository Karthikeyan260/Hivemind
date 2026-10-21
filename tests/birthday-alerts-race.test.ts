import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, unknown>();
vi.mock("@/lib/private-store", () => ({
  readJSON: async (_s: unknown, key: string, fallback: unknown) => (files.has(key) ? structuredClone(files.get(key)) : fallback),
  writeJSON: async (_s: unknown, key: string, value: unknown) => void files.set(key, structuredClone(value)),
}));
// Sending a push takes a moment: the window in which the owner might change the list.
let whileSending: () => Promise<void> = async () => {};
const sent: string[] = [];
vi.mock("@/lib/push", () => ({
  notify: async (_s: unknown, p: { title: string }) => {
    sent.push(p.title);
    await whileSending();
    return 1;
  },
}));
vi.mock("@/lib/ai/providers", () => ({ generateWithFallback: async () => ({ text: "" }) }));
vi.mock("@/lib/contacts", () => ({ findContacts: async () => [], whatsappLink: () => "" }));

import { addBirthday, listBirthdays, runBirthdayAlerts } from "@/lib/birthdays";

const supabase = {} as never;
// 21 Oct 2026, 9 am in India: a morning, so "today" alerts go out.
const MORNING = new Date("2026-10-21T09:00:00+05:30");

describe("birthday alerts don't wipe changes made while a push is being sent", () => {
  beforeEach(() => {
    files.clear();
    sent.length = 0;
    whileSending = async () => {};
  });

  it("a birthday added during the send is kept, and the alert is remembered as sent", async () => {
    files.set("birthdays", [{ id: "b1", name: "Priya", month: 10, day: 21, kind: "birthday" }]);
    whileSending = async () => {
      await addBirthday(supabase, { name: "Arun", month: 12, day: 5, kind: "birthday" });
    };
    expect(await runBirthdayAlerts(supabase, MORNING)).toBe(1);
    const list = await listBirthdays(supabase);
    expect(list.map((b) => b.name).sort()).toEqual(["Arun", "Priya"]);
    expect(list.find((b) => b.name === "Priya")?.sent?.day).toBe(2026);
  });

  it("a birthday removed during the send stays removed", async () => {
    files.set("birthdays", [
      { id: "b1", name: "Priya", month: 10, day: 21, kind: "birthday" },
      { id: "b2", name: "Kavin", month: 6, day: 1, kind: "birthday" },
    ]);
    whileSending = async () => {
      files.set("birthdays", (files.get("birthdays") as { id: string }[]).filter((b) => b.id !== "b2"));
    };
    await runBirthdayAlerts(supabase, MORNING);
    expect((await listBirthdays(supabase)).map((b) => b.name)).toEqual(["Priya"]);
  });

  it("it doesn't alert twice for the same day", async () => {
    files.set("birthdays", [{ id: "b1", name: "Priya", month: 10, day: 21, kind: "birthday" }]);
    await runBirthdayAlerts(supabase, MORNING);
    await runBirthdayAlerts(supabase, MORNING);
    expect(sent).toHaveLength(1);
  });
});

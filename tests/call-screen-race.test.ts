import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, unknown>();
vi.mock("@/lib/private-store", () => ({
  readJSON: async (_s: unknown, key: string, fallback: unknown) => (files.has(key) ? structuredClone(files.get(key)) : fallback),
  writeJSON: async (_s: unknown, key: string, value: unknown) => void files.set(key, structuredClone(value)),
}));
const notified: string[] = [];
vi.mock("@/lib/push", () => ({
  notify: async (_s: unknown, p: { title: string }) => {
    notified.push(p.title);
    return 1;
  },
}));
vi.mock("@/lib/tts", () => ({ synthesize: async () => ({ audio: Buffer.from("x"), mime: "audio/mpeg" }) }));
vi.mock("@/lib/my-voice", () => ({ getMyVoice: async () => null }));
// The AI answers after a delay, saying the call is done: the window in which other things can change.
let release: () => void = () => {};
vi.mock("@/lib/ai/gemini", () => ({
  GEMINI_CHAIN: ["m"],
  geminiClient: () => ({
    models: {
      generateContent: async () => {
        await new Promise<void>((r) => (release = r));
        return { text: JSON.stringify({ heard: "Priya here, about the flat", reply: "Thanks, I'll tell Karthik.", done: true, caller_name: "Priya", reason: "About the flat", urgent: false }) };
      },
    },
  }),
}));

import { deleteScreened, endScreen, listScreened, markScreenedRead, screenTurn, startScreen } from "@/lib/call-screen";

const supabase = {} as never;
const room = { room: "roomone12345", name: "Priya", from: "Karthik", created: new Date().toISOString() };
const other = { room: "roomtwo12345", name: "Arun", from: "Karthik", created: new Date().toISOString() };

describe("call screening: nothing is lost while the AI is thinking", () => {
  beforeEach(() => {
    files.clear();
    notified.length = 0;
  });

  it("a screening that starts during another call's AI wait is kept", async () => {
    const a = await startScreen(supabase, room, "Priya");
    const turn = screenTurn(supabase, room, a!.id, "wav");
    await vi.waitFor(() => expect(release).not.toBe(undefined));
    await new Promise((r) => setTimeout(r, 10));
    await startScreen(supabase, other, "Arun"); // a second caller, meanwhile
    release();
    await turn;
    const log = await listScreened(supabase);
    expect(log.map((s) => s.caller).sort()).toEqual(["Arun", "Priya"]);
  });

  it("the owner marking it read, or clearing the log, during the wait isn't undone", async () => {
    const a = await startScreen(supabase, room, "Priya");
    const turn = screenTurn(supabase, room, a!.id, "wav");
    await new Promise((r) => setTimeout(r, 10));
    await markScreenedRead(supabase);
    release();
    await turn;
    expect((await listScreened(supabase))[0].read).toBe(true);
  });

  it("a hang-up during the wait finishes the call once: one notification", async () => {
    const a = await startScreen(supabase, room, "Priya");
    const turn = screenTurn(supabase, room, a!.id, "wav");
    await new Promise((r) => setTimeout(r, 10));
    await endScreen(supabase, room, a!.id); // the caller hangs up
    release();
    await turn;
    expect(notified).toHaveLength(1);
    expect((await listScreened(supabase))).toHaveLength(1);
    void deleteScreened;
  });
});

import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A tiny in-memory stand-in for the private store.
const store = new Map<string, unknown>();
vi.mock("@/lib/private-store", () => ({
  readJSON: async (_s: unknown, key: string, fallback: unknown) => (store.has(key) ? store.get(key) : fallback),
  writeJSON: async (_s: unknown, key: string, value: unknown) => {
    store.set(key, value);
  },
}));

import { isRoomCode } from "@/lib/theatre/protocol";
import { getRoomCode, rotateRoomCode } from "@/lib/theatre/room";

const sb = {} as SupabaseClient;

describe("the permanent theatre room", () => {
  beforeEach(() => store.clear());

  it("makes a valid code the first time and gives the very same one every time after", async () => {
    const a = await getRoomCode(sb);
    expect(isRoomCode(a)).toBe(true);
    expect(await getRoomCode(sb)).toBe(a);
    expect(await getRoomCode(sb)).toBe(a);
  });

  it("makes a new code when asked, and that one then stays", async () => {
    const a = await getRoomCode(sb);
    const b = await rotateRoomCode(sb);
    expect(b).not.toBe(a);
    expect(isRoomCode(b)).toBe(true);
    expect(await getRoomCode(sb)).toBe(b);
  });

  it("doesn't trust a stored value that isn't a valid code (a hand-edited file can't plant a bad link)", async () => {
    store.set("theatre-room", { code: "../../etc/passwd" });
    const c = await getRoomCode(sb);
    expect(isRoomCode(c)).toBe(true);
    expect(c).not.toContain("/");
    store.set("theatre-room", { code: 12345 });
    expect(isRoomCode(await getRoomCode(sb))).toBe(true);
  });
});

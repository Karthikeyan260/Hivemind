import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const hit = { title: "Arif", content: "Arif's phone number is 98765 43210.", parent_id: "m1" };
vi.mock("@/lib/rag/retrieval", () => ({ searchKnowledge: async () => [hit] }));

import { findContacts } from "@/lib/contacts";

describe("findContacts", () => {
  it("finds a named person", async () => {
    expect((await findContacts({} as never, "Arif")).map((c) => c.phone)).toEqual(["+919876543210"]);
  });
  it("an empty name finds nobody (not the first number in the brain)", async () => {
    expect(await findContacts({} as never, "")).toEqual([]);
    expect(await findContacts({} as never, "   ")).toEqual([]);
  });
  it("a one-letter name does not match every number", async () => {
    expect(await findContacts({} as never, "Z")).toEqual([]);
  });
});

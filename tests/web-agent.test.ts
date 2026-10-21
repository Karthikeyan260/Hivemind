import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/providers", () => ({ generateWithFallback: async () => ({ text: "" }), parseJson: () => null }));
vi.mock("@/lib/profile", () => ({ getProfile: async () => ({}), profileForPrompt: () => "" }));
vi.mock("@/lib/push", () => ({ notify: async () => 0 }));
vi.mock("@/lib/rag/retrieval", () => ({ searchKnowledge: async () => [] }));
vi.mock("@/lib/private-store", () => ({ readJSON: async (_s: unknown, _k: string, f: unknown) => f, writeJSON: async () => {}, readFile: async () => null, writeFile: async () => {}, removeFiles: async () => {}, listFiles: async () => [] }));
vi.mock("playwright-core", () => ({}));
vi.mock("@/lib/web-agent/page", () => ({ act: async () => {}, attach: async () => {}, describe: () => "", screenshot: async () => null, snapshot: async () => null }));
vi.mock("@/lib/web-agent/steel", () => ({ createSession: async () => ({}), releaseSession: async () => {}, SESSION_MS: 1 }));

describe("the data-leak check copes with real-world web addresses", () => {
  const task = { id: "t", goal: "g", status: "running", created_at: "", updated_at: "", steps: [] } as never;
  it("a stray % in an address doesn't crash it", async () => {
    const { leaksOwnerData } = await import("@/lib/web-agent/runner");
    expect(() => leaksOwnerData(task, { type: "goto", url: "https://shop.example/sale?discount=100%" })).not.toThrow();
    expect(() => leaksOwnerData(task, { type: "goto", url: "https://x.example/%E0%A4%A" })).not.toThrow();
    expect(leaksOwnerData(task, { type: "goto", url: "https://shop.example/sale?discount=100%" })).toBeNull();
  });
  it("it still spots an email hidden in a malformed address", async () => {
    const { leaksOwnerData } = await import("@/lib/web-agent/runner");
    expect(leaksOwnerData(task, { type: "goto", url: "https://x.example/?q=100%&e=me@example.com" })).toBe("an email address");
  });
});

describe("safeDecode", () => {
  it("decodes what it can and returns the rest as it is", async () => {
    const { safeDecode } = await import("@/lib/safe-decode");
    expect(safeDecode("hello%20world")).toBe("hello world");
    expect(safeDecode("100%")).toBe("100%");
    expect(safeDecode("%E0%A4%A")).toBe("%E0%A4%A");
    expect(safeDecode("caf%C3%A9")).toBe("café");
  });
});

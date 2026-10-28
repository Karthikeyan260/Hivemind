import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const files = new Map<string, unknown>();
vi.mock("@/lib/private-store", () => ({
  readJSON: async (_s: unknown, key: string, fallback: unknown) => (files.has(key) ? structuredClone(files.get(key)) : fallback),
  writeJSON: async (_s: unknown, key: string, value: unknown) => void files.set(key, structuredClone(value)),
}));
const sent: { endpoint: string; opts: Record<string, unknown> }[] = [];
let behaviour: (endpoint: string) => Promise<void> = async () => {};
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async (s: { endpoint: string }, _body: string, opts: Record<string, unknown>) => {
      sent.push({ endpoint: s.endpoint, opts });
      await behaviour(s.endpoint);
    },
  },
}));

import { notify } from "@/lib/push";

const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: "p", auth: "a" } });
const supabase = {} as never;

describe("notify", () => {
  beforeEach(() => {
    files.clear();
    sent.length = 0;
    behaviour = async () => {};
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
  });

  it("sends to every device, with a time limit so a silent push service can't hold things up", async () => {
    files.set("push-subscriptions", [sub("https://a"), sub("https://b")]);
    expect(await notify(supabase, { title: "t", body: "b" })).toBe(2);
    expect(sent.every((s) => s.opts.timeout === 10_000)).toBe(true);
  });

  it("drops a device that is gone (410) and keeps the rest, and doesn't count it as sent", async () => {
    files.set("push-subscriptions", [sub("https://a"), sub("https://dead")]);
    behaviour = async (e) => {
      if (e === "https://dead") throw Object.assign(new Error("gone"), { statusCode: 410 });
    };
    expect(await notify(supabase, { title: "t", body: "b" })).toBe(1);
    expect((files.get("push-subscriptions") as { endpoint: string }[]).map((s) => s.endpoint)).toEqual(["https://a"]);
  });

  it("a device that subscribed while sending is not wiped by the clean-up", async () => {
    files.set("push-subscriptions", [sub("https://a"), sub("https://dead")]);
    behaviour = async (e) => {
      if (e === "https://dead") {
        // a new device subscribes while this notification is being sent
        files.set("push-subscriptions", [sub("https://a"), sub("https://dead"), sub("https://new")]);
        throw Object.assign(new Error("gone"), { statusCode: 404 });
      }
    };
    await notify(supabase, { title: "t", body: "b" });
    expect((files.get("push-subscriptions") as { endpoint: string }[]).map((s) => s.endpoint)).toEqual(["https://a", "https://new"]);
  });

  it("does nothing, and says 0, when push isn't set up or nobody is subscribed", async () => {
    expect(await notify(supabase, { title: "t", body: "b" })).toBe(0);
    delete process.env.VAPID_PUBLIC_KEY;
    files.set("push-subscriptions", [sub("https://a")]);
    expect(await notify(supabase, { title: "t", body: "b" })).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

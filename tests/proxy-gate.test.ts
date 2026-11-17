import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { unlocked: false, misconfigured: false };
vi.mock("@/lib/session", () => ({
  SESSION_COOKIE: "sb_owner",
  isUnlocked: async () => state.unlocked,
  misconfigured: () => state.misconfigured,
}));

import { config, proxy } from "@/proxy";

const call = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) => proxy(new NextRequest(`http://localhost${path}`, init));
const passes = (r: Response) => r.headers.get("x-middleware-next") === "1";

beforeEach(() => {
  state.unlocked = false;
  state.misconfigured = false;
});

describe("proxy: the password gate", () => {
  it("lets the named public doors through without a session", async () => {
    for (const p of ["/unlock", "/api/unlock", "/manifest.webmanifest", "/sw.js", "/robots.txt", "/api/call/ring", "/api/call/screen", "/api/games/knock", "/api/peer/verify", "/api/ice", "/call/abc12345", "/play/abc12345", "/theatre/abc12345"]) {
      expect(passes(await call(p)), p).toBe(true);
    }
  });

  it("refuses everything else: pages redirect to /unlock, APIs answer 401", async () => {
    for (const p of ["/", "/notes", "/memories", "/settings", "/garden", "/karaoke", "/theatre", "/call", "/play", "/games/chess"]) {
      const r = await call(p);
      expect(r.status, p).toBe(307);
      expect(new URL(r.headers.get("location")!).pathname, p).toBe("/unlock");
    }
    for (const p of ["/api/notes", "/api/export", "/api/memories", "/api/peer/proof", "/api/brain", "/api/sessions", "/api/theatre/room", "/api/music/lyrics", "/api/unlock/extra", "/api/ice/x", "/api/call/ring/x"]) {
      const r = await call(p);
      expect(r.status, p).toBe(401);
      expect(await r.json()).toEqual({ error: "Locked" });
    }
  });

  it("open prefixes do not open look-alike paths", async () => {
    for (const p of ["/callme", "/playground", "/theatres", "/api/callx", "/unlock2", "/api/unlockx", "/sw.json", "/robots.txt.bak"]) {
      expect(passes(await call(p)), p).toBe(false);
    }
  });

  it("a signed-in browser passes everywhere", async () => {
    state.unlocked = true;
    for (const p of ["/notes", "/api/notes", "/api/export"]) expect(passes(await call(p)), p).toBe(true);
  });

  it("without an APP_PASSWORD in production, everything private answers 503 (never open)", async () => {
    state.misconfigured = true;
    for (const p of ["/notes", "/api/notes", "/"]) expect((await call(p)).status, p).toBe(503);
    // The public doors still work, as before.
    expect(passes(await call("/unlock"))).toBe(true);
  });

  it("the cookie is what decides: a made-up cookie name does nothing", async () => {
    const r = await call("/api/notes", { headers: { cookie: "sb_owner=1; session=1; auth=true" } });
    expect(r.status).toBe(401);
  });
});

describe("proxy: which requests skip the gate (the matcher)", () => {
  const pattern = config.matcher[0];
  // Next treats the matcher as a path pattern; this one is a plain regular expression after the leading "/".
  const re = new RegExp(`^${pattern}$`);
  const gated = (p: string) => re.test(p);

  it("only build files, app icons and the public drawings skip the gate", () => {
    for (const p of ["/_next/static/chunks/a.js", "/_next/image", "/favicon.ico", "/icon.svg", "/apple-icon.png", "/icons/icon-192.png", "/chess/wK.svg", "/mascots/nova-idle.webp", "/theatre/poster.jpg", "/api/cron/notify"]) {
      expect(gated(p), p).toBe(false);
    }
  });

  it("everything else is gated, including images and look-alikes (never excluded by file extension)", () => {
    for (const p of ["/", "/notes", "/api/notes", "/api/x/anything.png", "/api/export.json", "/photo.png", "/mascots/karthik-directions.webp", "/mascots/karthik.webp", "/mascots/nova", "/icons", "/chess", "/_next/data/x.json", "/_nextx", "/theatre", "/api/cronx", "/api/cron"]) {
      expect(gated(p), p).toBe(true);
    }
  });
});

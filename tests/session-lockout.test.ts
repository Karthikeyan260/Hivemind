import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: () => ({}) }));

// An in-memory stand-in for the private bucket (JSON files and event markers).
const files = new Map<string, unknown>();
const markers = new Map<string, number[]>();
vi.mock("@/lib/private-store", () => ({
  readJSON: async (_s: unknown, key: string, fallback: unknown) => (files.has(key) ? structuredClone(files.get(key)) : fallback),
  writeJSON: async (_s: unknown, key: string, value: unknown) => void files.set(key, structuredClone(value)),
  addMarker: async (_s: unknown, prefix: string) => void markers.set(prefix, [...(markers.get(prefix) ?? []), Date.now()]),
  countMarkers: async (_s: unknown, prefix: string, since: number) => (markers.get(prefix) ?? []).filter((t) => t >= since).length,
  clearMarkers: async (_s: unknown, prefix: string) => void markers.delete(prefix),
}));

const SECRET = "s".repeat(40);
const PASSWORD = "correct-horse-battery";
let ipCounter = 0;
const newIp = () => `10.9.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

beforeEach(() => {
  files.clear();
  markers.clear();
  vi.resetModules();
  vi.stubEnv("APP_PASSWORD", PASSWORD);
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("PEER_SECRET", "p".repeat(40));
  vi.stubEnv("NODE_ENV", "production");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const session = () => import("@/lib/session");

describe("sessions", () => {
  it("a fresh login is accepted; a missing, garbled or unsigned cookie is not", async () => {
    const s = await session();
    const cookie = await s.createSession("test phone");
    expect(await s.isUnlocked(cookie)).toBe(true);
    for (const bad of [undefined, "", "1", "true", "v2.", `v2.${"a".repeat(48)}.${"0".repeat(64)}`, cookie.slice(0, -1), cookie + "0", cookie.replace(/^v2/, "v1")]) {
      expect(await s.isUnlocked(bad), String(bad)).toBe(false);
    }
  });

  it("a cookie signed with another secret (a forged login) is refused", async () => {
    const s = await session();
    const cookie = await s.createSession("a");
    const [v, sid] = cookie.split(".");
    vi.resetModules();
    vi.stubEnv("SESSION_SECRET", "x".repeat(40));
    const other = await session();
    expect(await other.isUnlocked(`${v}.${sid}.${"0".repeat(64)}`)).toBe(false);
    // And a genuine cookie from the first secret does not verify under the second.
    expect(await other.isUnlocked(cookie)).toBe(false);
  });

  it("logging out ends only that browser; \"log out all devices\" ends every one", async () => {
    const s = await session();
    const a = await s.createSession("a");
    const b = await s.createSession("b");
    await s.endSession(a);
    expect(await s.isUnlocked(a)).toBe(false);
    expect(await s.isUnlocked(b)).toBe(true);
    await s.endAllSessions();
    expect(await s.isUnlocked(b)).toBe(false);
  });

  it("changing the password signs every device out", async () => {
    const s = await session();
    const cookie = await s.createSession("a");
    expect(await s.isUnlocked(cookie)).toBe(true);
    vi.stubEnv("APP_PASSWORD", "a-brand-new-password");
    expect(await s.isUnlocked(cookie)).toBe(false);
  });

  it("an expired session is refused", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const s = await session();
    const cookie = await s.createSession("a");
    expect(await s.isUnlocked(cookie)).toBe(true);
    vi.setSystemTime(new Date(Date.now() + (s.SESSION_MAX_AGE + 60) * 1000));
    expect(await s.isUnlocked(cookie)).toBe(false);
  });

  it("with no password set, production stays locked; development is open", async () => {
    vi.stubEnv("APP_PASSWORD", "");
    const s = await session();
    expect(s.misconfigured()).toBe(true);
    expect(await s.isUnlocked(undefined)).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect(s.misconfigured()).toBe(false);
    expect(await s.isUnlocked(undefined)).toBe(true);
  });

  it("safeEqual compares exactly", async () => {
    const { safeEqual } = await session();
    expect(safeEqual("abc", "abc")).toBe(true);
    for (const [a, b] of [["abc", "abd"], ["abc", "abcd"], ["", "a"], ["abc", "ABC"]]) expect(safeEqual(a, b)).toBe(false);
  });

  it("the trusted-browser cookie verifies only when signed by the server", async () => {
    const s = await session();
    const t = await s.trustedCookie();
    expect(await s.isTrusted(t)).toBe(true);
    expect(await s.isTrusted(`${"a".repeat(24)}.${"0".repeat(64)}`)).toBe(false);
    expect(await s.isTrusted("1")).toBe(false);
    expect(await s.isTrusted(undefined)).toBe(false);
  });

  it("a peer proof is bound to its kind, room and nonce", async () => {
    const { peerProof } = await session();
    const p = await peerProof("call", "room12345", "n".repeat(20));
    expect(await peerProof("call", "room12345", "n".repeat(20))).toBe(p);
    expect(await peerProof("chess", "room12345", "n".repeat(20))).not.toBe(p);
    expect(await peerProof("call", "room99999", "n".repeat(20))).not.toBe(p);
    expect(await peerProof("call", "room12345", "m".repeat(20))).not.toBe(p);
  });
});

/** Posts to the real /api/unlock handler. The 0.8 s pause after a wrong guess is skipped so the test runs fast. */
async function unlockRoute() {
  const realSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => realSetTimeout(fn, ms === 800 ? 0 : ms)) as typeof setTimeout);
  return import("@/app/api/unlock/route");
}
const post = (route: { POST: (r: Request) => Promise<Response> }, password: unknown, ip: string, cookie?: string) =>
  route.POST(new Request("http://x/api/unlock", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ password }) }));

describe("/api/unlock", () => {
  it("a wrong password is 401 and sets no cookie; the right one sets a session", async () => {
    const route = await unlockRoute();
    const ip = newIp();
    const bad = await post(route, "nope", ip);
    expect(bad.status).toBe(401);
    expect(bad.headers.get("set-cookie")).toBeNull();
    const good = await post(route, PASSWORD, ip);
    expect(good.status).toBe(200);
    const cookies = good.headers.getSetCookie().join("\n");
    expect(cookies).toMatch(/sb_owner=v2\.[a-f0-9]{48}\.[a-f0-9]{64}/);
    expect(cookies).toMatch(/HttpOnly/i);
    expect(cookies).toMatch(/Secure/i);
    expect(cookies).toMatch(/SameSite=lax/i);
    expect(cookies).toMatch(/sb_trusted=/);
  });

  it("odd bodies are refused, never a session or a server error", async () => {
    const route = await unlockRoute();
    for (const pw of [undefined, null, 0, true, [], ["x"], {}, { $ne: "" }, "", "x".repeat(10_000)]) {
      const r = await post(route, pw, newIp());
      expect(r.status, JSON.stringify(pw)?.slice(0, 30)).toBe(401);
      expect(r.headers.get("set-cookie")).toBeNull();
    }
    for (const raw of ["", "{{{", "null", "[]"]) {
      const r = await route.POST(new Request("http://x/api/unlock", { method: "POST", headers: { "x-real-ip": newIp() }, body: raw }));
      expect(r.status, raw).toBe(401);
    }
  });

  it("after 8 wrong passwords from one address, that address is locked out, even with the right password", async () => {
    const route = await unlockRoute();
    const ip = newIp();
    for (let i = 0; i < 8; i++) expect((await post(route, "wrong" + i, ip)).status).toBe(401);
    const locked = await post(route, "wrong-again", ip);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await post(route, PASSWORD, ip)).status).toBe(429);
    // A different address is not affected.
    expect((await post(route, PASSWORD, newIp())).status).toBe(200);
  });

  it("parallel guesses cannot slip past the limit", async () => {
    const route = await unlockRoute();
    const ip = newIp();
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => post(route, "guess" + i, ip)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(8);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(22);
    expect(statuses.every((s) => s === 401 || s === 429)).toBe(true);
  });

  it("the lockout ends after the 15-minute window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const route = await unlockRoute();
    const ip = newIp();
    for (let i = 0; i < 8; i++) await post(route, "w" + i, ip);
    expect((await post(route, PASSWORD, ip)).status).toBe(429);
    vi.setSystemTime(new Date(Date.now() + 16 * 60_000));
    expect((await post(route, PASSWORD, ip)).status).toBe(200);
  });

  it("guessing from many addresses is stopped overall, but a browser that signed in before is still let in", async () => {
    const route = await unlockRoute();
    const s = await session();
    const trusted = `sb_trusted=${await s.trustedCookie()}`;
    // 60 failures spread over many different addresses.
    for (let i = 0; i < 60; i++) expect((await post(route, "x" + i, newIp())).status).toBe(401);
    expect((await post(route, PASSWORD, newIp())).status).toBe(429);
    // The owner's own browser (trusted cookie) from a fresh address is not held by the overall limit.
    expect((await post(route, PASSWORD, newIp(), trusted)).status).toBe(200);
    // A forged trusted cookie gets no such pass.
    expect((await post(route, PASSWORD, newIp(), `sb_trusted=${"a".repeat(24)}.${"0".repeat(64)}`)).status).toBe(429);
  });

  it("a right password clears that address's failures", async () => {
    const route = await unlockRoute();
    const ip = newIp();
    for (let i = 0; i < 5; i++) await post(route, "w" + i, ip);
    expect((await post(route, PASSWORD, ip)).status).toBe(200);
    for (let i = 0; i < 7; i++) expect((await post(route, "again" + i, ip)).status).toBe(401);
  });

  it("DELETE logs out this browser; ?all=1 needs a signed-in browser", async () => {
    const route = await unlockRoute();
    const s = await session();
    const cookie = await s.createSession("a");
    const other = await s.createSession("b");
    const anon = await route.DELETE(new Request("http://x/api/unlock?all=1", { method: "DELETE" }));
    expect(anon.status).toBe(401);
    expect(await s.isUnlocked(other)).toBe(true);
    const out = await route.DELETE(new Request("http://x/api/unlock", { method: "DELETE", headers: { cookie: `sb_owner=${cookie}` } }));
    expect(out.status).toBe(204);
    expect(await s.isUnlocked(cookie)).toBe(false);
    expect(await s.isUnlocked(other)).toBe(true);
    const all = await route.DELETE(new Request("http://x/api/unlock?all=1", { method: "DELETE", headers: { cookie: `sb_owner=${other}` } }));
    expect(all.status).toBe(204);
    expect(await s.isUnlocked(other)).toBe(false);
  });
});

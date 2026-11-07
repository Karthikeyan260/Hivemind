import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { MOVIES } from "../lib/theatre/catalog";

/**
 * Friends Theatre security, in real browsers, against the real server build. The room link is a secret that is public to
 * everyone who holds it, so this plays the part of someone holding it who means harm: the page's headers and third-party
 * calls, the owner's room-code API, tricks with the URL, and (needing PeerJS's free broker) a hostile peer that joins a
 * live room and sends everything it can think of while an honest friend keeps watching.
 */
test.skip(({ isMobile }) => isMobile, "these tests drive several desktop browsers");

const code = () => Math.random().toString(16).slice(2, 14).padEnd(12, "a");
const film = MOVIES.find((m) => m.id === "mayabazar")!;
const BOX = "Say something…";
const T = 60_000;

test.describe("a room page, from outside", () => {
  test("is served with the browser protections on, and sets no cookie", async ({ request }) => {
    const r = await request.get(`/theatre/${code()}?m=${film.id}`);
    expect(r.status()).toBe(200);
    const h = r.headers();
    expect(h["x-frame-options"]).toBe("DENY"); // no other site can frame the room (clickjacking)
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"]).toContain("object-src 'none'");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin"); // the room code never leaves in a Referer to another site
    expect(h["x-robots-tag"]).toContain("noindex"); // search engines never list a room
    expect(h["permissions-policy"]).toContain("microphone=(self)");
    expect(h["permissions-policy"]).toContain("geolocation=(self)");
    expect(h["set-cookie"]).toBeUndefined(); // a room link gives no session, to anyone
  });

  test("a made-up link, with every trick in the book, shows nothing and reaches nothing", async ({ request }) => {
    const tricks = [
      "/theatre/%2e%2e/api/notes",
      "/theatre/..%2fapi%2fnotes",
      "/theatre/%252e%252e/api/notes",
      "/theatre/..%5capi%5cnotes",
      "/theatre/abcdefgh%00",
      "/theatre/abcdefgh%0d%0aSet-Cookie:%20x=1",
      "/theatre/<script>alert(1)</script>",
      "/theatre/abcdefgh/../../api/notes",
      "/theatre/;/api/notes",
      "/theatre/" + "a".repeat(5000),
    ];
    for (const p of tricks) {
      const r = await request.get(p, { maxRedirects: 0 });
      const type = r.headers()["content-type"] ?? "";
      // never the owner's data, never a redirect that leaks, never a header injected from the URL
      expect(type.includes("application/json") && r.status() === 200, p).toBe(false);
      expect(r.headers()["set-cookie"], p).toBeUndefined();
      expect(r.headers()["x"], p).toBeUndefined();
      expect([200, 307, 308, 400, 401, 404, 414, 431], `${p} -> ${r.status()}`).toContain(r.status());
    }
  });

  test("calls no other site until a person has chosen to join (no broker, no tracker, nothing)", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const room = code();
    const others = new Set<string>();
    const referers: string[] = [];
    page.on("request", async (r) => {
      const u = new URL(r.url());
      if (u.hostname === "localhost" || u.protocol === "data:" || u.protocol === "blob:") return;
      others.add(u.hostname);
      referers.push((await r.allHeaders()).referer ?? "");
    });
    await page.goto(`/theatre/${room}?m=${film.id}`);
    await expect(page.getByRole("button", { name: /Join the screening/ })).toBeVisible();
    await page.waitForTimeout(4000);
    // Only the invite's own poster may load from elsewhere (Wikimedia Commons for this film). Nothing else.
    expect([...others].filter((h) => !["upload.wikimedia.org", "i.ytimg.com"].includes(h))).toEqual([]);
    // ...and the room code is never in a Referer sent to another site.
    for (const ref of referers) expect(ref).not.toContain(room);
    await ctx.close();
  });
});

test.describe("the owner's room-code API", () => {
  test("is locked to everyone without the owner's session, whatever they send", async ({ request }) => {
    const forged = `sb_owner=v2.${"a".repeat(48)}.${"b".repeat(64)}`;
    const attempts: Array<Record<string, string>> = [
      {},
      { cookie: forged },
      { cookie: "sb_owner=true" },
      { cookie: "sb_owner=" },
      { origin: "https://evil.example", cookie: forged },
      { referer: "https://evil.example/", "x-forwarded-for": "127.0.0.1" },
      { authorization: "Bearer admin" },
      { "x-middleware-subrequest": "middleware" }, // a known header trick to skip a gate
    ];
    for (const headers of attempts) {
      for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"] as const) {
        const r = await request.fetch("/api/theatre/room", { method, headers });
        expect(r.status(), `${method} ${JSON.stringify(headers)}`).toBe(401);
        expect(await r.text(), method).not.toMatch(/[A-Za-z0-9]{16}/);
      }
    }
  });

  test("a page on another site can't use the owner's session to read or change the link", async ({ request }) => {
    // The session cookie is SameSite=Lax and HttpOnly: a cross-site POST carries none, so it is refused like any stranger.
    const r = await request.post("/api/theatre/room", { headers: { origin: "https://evil.example", "content-type": "text/plain", "sec-fetch-site": "cross-site" } });
    expect(r.status()).toBe(401);
  });
});

async function needBroker(browser: Browser) {
  const ctx = await browser.newContext();
  let ok = false;
  for (let i = 0; i < 3 && !ok; i++) ok = await ctx.request.get("https://0.peerjs.com/", { timeout: 10_000 }).then((r) => r.ok(), () => false);
  await ctx.close();
  test.skip(!ok, "PeerJS's broker can't be reached from here");
}

async function arrive(browser: Browser, room: string, name: string): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`/theatre/${room}?m=${film.id}`);
  await page.locator("#nm").fill(name);
  await page.getByRole("button", { name: /Open the room|Join the screening/ }).click();
  await expect(page.getByPlaceholder(BOX)).toBeVisible({ timeout: T });
  return { ctx, page, errors };
}

test.describe("a hostile peer inside a live room", () => {
  test("can't run code, steer the film, flood the chat, crowd the room or freeze anyone", async ({ browser }) => {
    test.setTimeout(240_000);
    await needBroker(browser);
    const room = code();
    const host = await arrive(browser, room, "Host");
    const friend = await arrive(browser, room, "Priya");
    await expect(host.page.getByText("Priya joined")).toBeVisible({ timeout: T });
    await expect(friend.page.getByText("Host joined")).toBeVisible({ timeout: T });

    // In its first seconds a new opener asks whoever arrives "where is the film?" and believes the answer (that's how a room
    // that was empty for a moment learns where the others are; every member can already press play or seek). Once the room
    // has settled, forged heartbeats and states mean nothing: that is what this test attacks, so let the room settle first.
    await host.page.waitForTimeout(12_000);

    // The attacker: another browser holding the same link, speaking the room's protocol by hand.
    const actx = await browser.newContext();
    const attacker = await actx.newPage();
    await attacker.goto("/unlock");
    await attacker.addScriptTag({ path: path.join(process.cwd(), "node_modules/peerjs/dist/peerjs.min.js") });

    const report = await attacker.evaluate(
      async ({ hostId }) => {
        const { Peer } = (window as unknown as { peerjs: { Peer: new () => any } }).peerjs; // eslint-disable-line @typescript-eslint/no-explicit-any
        const make = () => new Promise<any>((res) => { // eslint-disable-line @typescript-eslint/no-explicit-any
          const p = new Peer();
          p.on("open", () => res(p));
        });
        const dial = (peer: any, id: string) => // eslint-disable-line @typescript-eslint/no-explicit-any
          new Promise<any>((res, rej) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            const c = peer.connect(id, { reliable: true });
            c.on("open", () => res(c));
            c.on("error", rej);
            setTimeout(() => rej(new Error("no answer from " + id)), 30_000);
          });
        const me = await make();
        const opener = await dial(me, hostId);
        // Say hello, and learn who else is in the room (the opener tells every newcomer).
        const list: string[] = await new Promise((res) => {
          opener.on("data", (d: { t?: string; list?: string[] }) => d?.t === "peers" && res(d.list ?? []));
          opener.send({ t: "hello", name: '<img src=x onerror="window.__pwned=1">' + "M".repeat(200) + "‮" });
        });
        const targets = [opener];
        let sent = 0;
        const skipped: string[] = [];
        for (const id of list) targets.push(await dial(me, id));
        // (about 1,250 times the chat limit)
        const huge = "A".repeat(500_000);
        const ghosts = Array.from({ length: 10_000 }, (_, i) => "ghost-" + i + "-abcd"); // (PeerJS can't pack a longer list at all)
        for (const c of targets) {
          c.send({ t: "hello", name: "Mallory" });
          const hostile: unknown[] = [
            { t: "chat", text: '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>' },
            { t: "chat", text: huge },
            { t: "hb", movie: "mayabazar", time: 5000, playing: true }, // forged heartbeat: the film is "at 83 minutes, playing"
            { t: "state", movie: "mayabazar", time: 5000, playing: true },
            { t: "play", time: 1e12 },
            { t: "seek", time: -5 },
            { t: "seek", time: NaN },
            { t: "movie", id: "https://evil.example/x.mp4" },
            { t: "movie", id: "../../../etc/passwd" },
            { t: "movie", id: "javascript:alert(1)" },
            { t: "peers", list: ghosts },
            { t: "react", e: "<svg onload=alert(1)>" },
            JSON.parse('{"t":"chat","text":"proto","__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}}}'),
            { t: "nope" },
            null,
            "chat",
            [1, 2, 3],
            42,
          ];
          hostile.forEach((m, i) => {
            try {
              c.send(m);
              sent++;
            } catch (e) {
              // PeerJS's own packer refuses a few odd shapes: note which, so the test can insist that nearly all really went out.
              skipped.push(`#${i}: ${String(e).slice(0, 40)}`);
            }
          });
          for (let i = 0; i < 300; i++) c.send({ t: "chat", text: "spam " + i });
          for (let i = 0; i < 300; i++) c.send({ t: "react", e: "😂" });
          for (let i = 0; i < 100; i++) c.send({ t: "hello", name: "N" + i });
        }
        // And try to fill the opener with connections.
        const crowd: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
        await Promise.allSettled(
          Array.from({ length: 24 }, async () => {
            const p = await make();
            crowd.push(await dial(p, hostId));
          }),
        );
        await new Promise((r) => setTimeout(r, 3000));
        return { reached: targets.length, sent, skipped, crowdAttempts: 24, crowdStillOpen: crowd.filter((c) => c.open).length };
      },
      { hostId: `hm-theatre-${room}` },
    );
    expect(report.reached).toBeGreaterThanOrEqual(2); // it really did get to both the opener and the friend
    console.log(`attacker sent ${report.sent} hostile messages; its own PeerJS refused: ${JSON.stringify(report.skipped)}`);
    expect(report.sent, `refused by the attacker's own library: ${report.skipped.join(", ")}`).toBeGreaterThanOrEqual(report.reached * 14); // of 18 each
    // The opener can hold 12 connections: the friend, the attacker and the rest of the crowd fill what's left, and no more.
    expect(report.crowdStillOpen).toBeLessThanOrEqual(12 - 2);

    for (const [who, p] of [["host", host], ["friend", friend]] as const) {
      // 1. Nothing ran, nothing was injected into the page.
      expect(await p.page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned), who).toBeUndefined();
      expect(await p.page.evaluate(() => ({} as Record<string, unknown>).polluted), who).toBeUndefined();
      expect(await p.page.locator("aside img[src='x'], aside script, aside svg[onload], header img[src='x']").count(), who).toBe(0);
      // 2. The film wasn't moved by forged heartbeats or states, and is still the same film.
      const v = await p.page.evaluate(() => ({ t: document.querySelector("video")?.currentTime ?? 0, paused: document.querySelector("video")?.paused ?? true }));
      expect(v.t, who).toBeLessThan(100);
      expect(v.paused, who).toBe(true);
      await expect(p.page.locator("header").getByText(film.title)).toBeVisible();
      // 3. The flood was cut off: only a handful of the 300 chat lines got through.
      const spam = await p.page.getByText(/^spam \d+$/).count();
      expect(spam, who).toBeLessThanOrEqual(10);
      // 4. The page itself is still alive and had no script errors.
      expect(await p.page.evaluate(() => 1 + 1), who).toBe(2);
      // (A literal `null` makes PeerJS's own handler throw before our code sees it: harmless, the connection and page carry on,
      // and a flood of them is cut off by the raw-traffic guard. It is the only error an attacker can cause, so it is the only one allowed.)
      expect(p.errors.filter((e) => !/__peerData/.test(e)), who).toEqual([]);
    }
    // The attacker's name was cleaned: capped, with no markup left running and no direction-flipping character.
    const shown = await host.page.locator("header").innerText();
    expect(shown).not.toMatch(/‮/);

    // 5. Honest people still talk to each other, right after the attack.
    await host.page.getByPlaceholder(BOX).fill("still working");
    await host.page.keyboard.press("Enter");
    await expect(friend.page.getByText("still working", { exact: true }).first()).toBeVisible({ timeout: T });
    await friend.page.getByPlaceholder(BOX).fill("me too");
    await friend.page.keyboard.press("Enter");
    await expect(host.page.getByText("me too", { exact: true }).first()).toBeVisible({ timeout: T });

    await Promise.all([actx.close(), host.ctx.close(), friend.ctx.close()]);
  });
});

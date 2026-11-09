import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../playwright.config";
import { MOVIES } from "../lib/theatre/catalog";

/**
 * Friends Theatre: safety (a room link is public, so the room must be safe in the hands of anyone holding it) and voice
 * control (the room and the shelf run by speaking, in English and Tamil). A microphone can't be used in a test, so phrases
 * are sent as the page event the speech listener also accepts (`hm-theatre-voice`); the browser's own recogniser is only
 * checked for "it listens, or says why it can't". The two-browser tests need PeerJS's free broker and skip without it.
 */
test.skip(({ isMobile }) => isMobile, "these tests drive several desktop browsers");

const room = () => Math.random().toString(16).slice(2, 14);
const classic = MOVIES.find((m) => m.id === "mayabazar")!;

async function unlock(page: Page) {
  await page.goto("/theatre");
  await expect(page).toHaveURL(/\/unlock$/);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page).not.toHaveURL(/\/unlock/, { timeout: 20_000 });
  await page.goto("/theatre");
  await expect(page).toHaveURL(/\/theatre$/);
}

async function brokerUp(page: Page) {
  // A slow answer once is not "down": try three times before skipping the room tests.
  for (let i = 0; i < 3; i++) {
    const r = await page.request.get("https://0.peerjs.com/", { timeout: 10_000 }).catch(() => null);
    if (r?.ok()) return true;
  }
  return false;
}

async function twoInOneRoom(browser: Browser, movieId: string) {
  const code = room();
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const host = await hostCtx.newPage();
  await host.goto(`/theatre/${code}?m=${movieId}&host=1`);
  await host.getByRole("button", { name: /Open the room/ }).click();
  await expect(host.getByPlaceholder("Say something…")).toBeVisible({ timeout: 40_000 });
  const guest = await guestCtx.newPage();
  await guest.goto(`/theatre/${code}?m=${movieId}`);
  await guest.getByPlaceholder(/call you/).fill("Priya");
  await guest.getByRole("button", { name: /Join the screening/ }).click();
  await expect(guest.getByPlaceholder("Say something…")).toBeVisible({ timeout: 40_000 });
  await expect(host.getByText("Priya joined")).toBeVisible({ timeout: 30_000 });
  return { host, guest, close: () => Promise.all([hostCtx.close(), guestCtx.close()]) };
}

/** Says a phrase (as the page event the speech listener accepts) and waits until the page has heard it (its "Heard" note). */
async function say(p: Page, text: string) {
  await p.evaluate((t) => window.dispatchEvent(new CustomEvent("hm-theatre-voice", { detail: t })), text);
  await expect(p.getByRole("status").filter({ hasText: text }).first()).toBeVisible({ timeout: 10_000 });
}
const video = (p: Page) =>
  p.evaluate(() => {
    const v = document.querySelector("video")!;
    return { paused: v.paused, t: v.currentTime, volume: v.volume, muted: v.muted };
  });

async function needBroker(browser: Browser) {
  const probe = await browser.newPage();
  const up = await brokerUp(probe);
  await probe.close();
  test.skip(!up, "PeerJS's broker can't be reached from here");
}

test.describe("safety", () => {
  test("a friend's page asks the server for nothing private", async ({ browser, baseURL }) => {
    const ownHost = new URL(baseURL ?? "http://localhost").hostname;
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    const calls: string[] = [];
    p.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/") && u.hostname === ownHost) calls.push(u.pathname);
    });
    await p.goto(`/theatre/${room()}?m=${classic.id}`);
    await expect(p.getByRole("button", { name: /Join the screening/ })).toBeVisible();
    await p.waitForTimeout(5000);
    // /api/ice (relay logins) and /api/version (the auto-update check, only in a production build) are the app-wide calls every page makes.
    expect([...new Set(calls)].filter((c) => c !== "/api/ice" && c !== "/api/version")).toEqual([]);
    // ...and the version check tells a friend nothing: refused without the password, and even then it is only a build id.
    const v = await p.request.get("/api/version");
    expect(v.status()).toBe(401);
    expect(await v.text()).not.toMatch(/build/i);
    await ctx.close();
  });

  test("the owner's data is refused to someone without the password", async ({ request }) => {
    for (const path of ["/api/notes", "/api/pet", "/api/apps", "/api/memories", "/api/tools/weather", "/api/mission", "/api/habits", "/api/photos", "/api/documents"]) {
      const r = await request.get(path);
      expect(r.status(), path).toBe(401);
    }
    const post = await request.post("/api/notes", { data: { title: "x", body: "y" } });
    expect(post.status()).toBe(401);
  });

  test("the permanent room link can't be read or changed without the password", async ({ request }) => {
    // Whoever has the link may join the room, but only the owner may see it, or make a new one.
    const read = await request.get("/api/theatre/room");
    expect(read.status()).toBe(401);
    expect(await read.text()).not.toMatch(/[A-Za-z0-9]{16}/);
    const rotate = await request.post("/api/theatre/room");
    expect(rotate.status()).toBe(401);
    const spoof = await request.post("/api/theatre/room", { headers: { Origin: "https://evil.example", Cookie: "hm_session=forged" } });
    expect(spoof.status()).toBe(401);
  });

  test("the shelf stays locked for a friend who only has a room link", async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`/theatre/${room()}?m=${classic.id}`);
    await p.goto("/theatre");
    await expect(p).toHaveURL(/\/unlock$/);
    await ctx.close();
  });

  test("a made-up room link shows nothing, and nothing runs", async ({ page }) => {
    for (const bad of ["short", "has%20space%20in%20it", "%3Cscript%3Ealert(1)%3C%2Fscript%3E", "..%2F..%2Fetc%2Fpasswd", "a1b2c3d4e5f6%21%21"]) {
      await page.goto(`/theatre/${bad}`);
      await expect(page.getByText("This link doesn't look right")).toBeVisible();
      await expect(page.getByRole("button", { name: /Join the screening|Open the room/ })).toHaveCount(0);
    }
  });

  test("a link can only choose films from the catalogue, never a source of its own", async ({ page }) => {
    await page.goto(`/theatre/${room()}?m=${encodeURIComponent("https://evil.example/x.mp4")}`);
    await expect(page.getByRole("button", { name: /Join the screening/ })).toBeVisible();
    expect(await page.locator("[src*='evil.example'], [href*='evil.example']").count()).toBe(0);
    await page.goto(`/theatre/${room()}?m=${encodeURIComponent('"><img src=x onerror=alert(1)>')}`);
    await expect(page.getByRole("button", { name: /Join the screening/ })).toBeVisible();
    expect(await page.locator("img[src='x']").count()).toBe(0);
  });

  test("markup typed into the chat is shown as text and never runs", async ({ browser }) => {
    test.setTimeout(150_000);
    await needBroker(browser);
    const { host, guest, close } = await twoInOneRoom(browser, classic.id);
    try {
      const evil = `<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>`;
      await guest.getByPlaceholder("Say something…").fill(evil);
      await guest.keyboard.press("Enter");
      await expect(host.getByText(evil, { exact: false })).toBeVisible({ timeout: 20_000 });
      expect(await host.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
      expect(await host.locator("aside img[src='x'], aside script").count()).toBe(0);
    } finally {
      await close();
    }
  });

  test("a second person opening the same link joins the room; they can't take it over", async ({ browser }) => {
    test.setTimeout(120_000);
    await needBroker(browser);
    const code = room();
    const a = await (await browser.newContext()).newPage();
    await a.goto(`/theatre/${code}?m=${classic.id}&host=1`);
    await a.getByRole("button", { name: /Open the room/ }).click();
    await expect(a.getByPlaceholder("Say something…")).toBeVisible({ timeout: 40_000 });
    await expect(a.getByText(/The room is open/)).toBeVisible();
    const b = await (await browser.newContext()).newPage();
    await b.goto(`/theatre/${code}?m=${classic.id}&host=1`);
    await b.getByRole("button", { name: /Open the room/ }).click();
    // b is a friend of the room now: it never says "the room is open" (it isn't the opener) and the first tab still holds the room.
    await expect(b.getByPlaceholder("Say something…")).toBeVisible({ timeout: 40_000 });
    await expect(a.getByText(/Host joined/)).toBeVisible({ timeout: 30_000 });
    await expect(b.getByText(/The room is open/)).toHaveCount(0);
    await a.getByPlaceholder("Say something…").fill("still here");
    await a.keyboard.press("Enter");
    await expect(b.getByText("still here")).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("voice control", () => {
  test("a room is run by voice: play, pause, jump, volume, mute, chat, reactions, another film", async ({ browser }) => {
    test.setTimeout(180_000);
    await needBroker(browser);
    const { host, guest, close } = await twoInOneRoom(browser, classic.id);
    try {
      await host.evaluate(() => {
        document.querySelector("video")!.muted = true;
      });
      await say(host, "play");
      await expect.poll(async () => (await video(guest)).paused, { timeout: 20_000 }).toBe(false);
      await expect(host.getByText("Playing", { exact: true })).toBeVisible();

      await say(host, "pause");
      await expect.poll(async () => (await video(guest)).paused, { timeout: 20_000 }).toBe(true);

      await say(host, "go to 10 minutes");
      await expect.poll(async () => Math.round((await video(guest)).t / 60), { timeout: 20_000 }).toBe(10);
      await say(host, "forward 30 seconds");
      await expect.poll(async () => Math.round((await video(guest)).t), { timeout: 20_000 }).toBeGreaterThanOrEqual(628);
      await say(host, "rewind 1 minute");
      await expect.poll(async () => Math.round((await video(guest)).t), { timeout: 20_000 }).toBeLessThan(600);

      await say(host, "volume 40");
      expect(Math.round((await video(host)).volume * 100)).toBe(40);
      await say(host, "volume up");
      expect(Math.round((await video(host)).volume * 100)).toBe(55);
      await say(host, "mute");
      expect((await video(host)).muted).toBe(true);
      await say(host, "unmute");
      expect((await video(host)).muted).toBe(false);
      expect(Math.round((await video(guest)).volume * 100)).toBe(100); // your volume is yours alone

      await say(host, "say hello from the sofa");
      await expect(guest.getByText("Hello from the sofa")).toBeVisible({ timeout: 20_000 });
      await say(host, "laugh");
      await expect(host.locator(".theatre-float")).not.toHaveCount(0);

      await say(host, "banana smoothie");
      await expect(host.getByText("I didn't catch a command")).toBeVisible();
      expect((await video(host)).paused).toBe(true);

      await say(host, "play Chandralekha");
      await expect(host.getByText("Chandralekha").first()).toBeVisible({ timeout: 20_000 });
      await expect(guest.getByText("Chandralekha").first()).toBeVisible({ timeout: 20_000 });

      await say(host, "help");
      await expect(host.getByText(/Say, in English or/)).toBeVisible();
    } finally {
      await close();
    }
  });

  test("a series moves on and back by voice", async ({ browser }) => {
    test.setTimeout(120_000);
    await needBroker(browser);
    const eps = MOVIES.filter((m) => m.series === "One-Punch Man").sort((a, b) => (a.ep ?? 0) - (b.ep ?? 0));
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`/theatre/${room()}?m=${eps[0].id}&host=1`);
    await p.getByRole("button", { name: /Open the room/ }).click();
    await expect(p.getByPlaceholder("Say something…")).toBeVisible({ timeout: 40_000 });
    await say(p, "next episode");
    await expect(p.getByText(`Next: ${eps[1].title}`)).toBeVisible();
    await say(p, "previous episode");
    await expect(p.getByText(`Previous: ${eps[0].title}`)).toBeVisible();
    await ctx.close();
  });

  test("Tamil commands work too", async ({ browser }) => {
    test.setTimeout(120_000);
    await needBroker(browser);
    const { host, guest, close } = await twoInOneRoom(browser, classic.id);
    try {
      await host.evaluate(() => {
        document.querySelector("video")!.muted = true;
      });
      await say(host, "ஓடு");
      await expect.poll(async () => (await video(guest)).paused, { timeout: 20_000 }).toBe(false);
      await say(host, "நிறுத்து");
      await expect.poll(async () => (await video(guest)).paused, { timeout: 20_000 }).toBe(true);
      await say(host, "சொல்லு அருமையான படம்");
      await expect(guest.getByText("அருமையான படம்")).toBeVisible({ timeout: 20_000 });
    } finally {
      await close();
    }
  });

  test("the Commands button listens, or says why it can't", async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`/theatre/${room()}?m=${classic.id}&host=1`);
    await p.getByRole("button", { name: /Open the room/ }).click();
    await expect(p.getByPlaceholder("Say something…")).toBeVisible({ timeout: 40_000 });
    await p.getByRole("button", { name: /Commands/ }).click();
    await expect(p.getByRole("button", { name: /Listening/ }).or(p.getByText(/blocked the microphone|can't listen/))).toBeVisible({ timeout: 10_000 });
    await ctx.close();
  });

  test("the shelf is run by voice: filter, search, open a film, start a screening", async ({ page }) => {
    await unlock(page);
    try {
      await expect(page.getByText("Recent hits · 2015 to now")).toBeVisible({ timeout: 30_000 });
      await say(page, "show kids cartoons");
      await expect(page.getByText("Cartoons for kids, in Tamil")).toBeVisible();
      await say(page, "show anime");
      await expect(page.getByText("Anime series, in Tamil")).toBeVisible();
      await say(page, "search mayabazar");
      await expect(page.getByText("Results for")).toBeVisible();
      await say(page, "clear");
      await say(page, "play mayabazar");
      await expect(page.getByRole("dialog", { name: "Mayabazar" })).toBeVisible();
      await say(page, "close");
      await expect(page.getByRole("dialog", { name: "Mayabazar" })).toHaveCount(0);
      await say(page, "start"); // nothing is open: no screening starts
      await expect(page).toHaveURL(/\/theatre$/);
      await say(page, "play mayabazar");
      await say(page, "start");
      await expect(page).toHaveURL(/\/theatre\/[a-z0-9]{12}\?m=mayabazar&host=1/, { timeout: 20_000 });
    } finally {
      await page.request.delete("/api/unlock").catch(() => {});
    }
  });
});

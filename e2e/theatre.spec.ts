import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../playwright.config";
import { MOVIES } from "../lib/theatre/catalog";

/**
 * Friends Theatre in a real browser: the shelf is private, a room link is not; two browsers join one room and
 * stay in step (chat, play, seek); a YouTube film loads in YouTube's player; a film YouTube won't embed gets the
 * "start together" countdown. The two-browser tests need PeerJS's free broker, so they skip when it can't be reached.
 */
test.skip(({ isMobile }) => isMobile, "the theatre tests drive two desktop browsers");

const room = () => Math.random().toString(16).slice(2, 14);
const classic = MOVIES.find((m) => m.id === "mayabazar")!;
const youtube = MOVIES.find((m) => m.yt && m.embed && m.group === "tamil")!;
const sony = MOVIES.find((m) => !m.embed)!;

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

/** The opener's page and a friend's page (a separate browser context, so no shared login), both inside one room. */
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

test("the shelf needs the password, a room link and the posters don't", async ({ page, request }) => {
  await page.goto("/theatre");
  await expect(page).toHaveURL(/\/unlock$/);
  const poster = await request.get(classic.poster);
  expect(poster.status()).toBe(200);
  expect(poster.headers()["content-type"]).toContain("image/jpeg");
  await page.goto(`/theatre/${room()}?m=${classic.id}`);
  await expect(page.getByRole("button", { name: /Join the screening/ })).toBeVisible();
  await expect(page).not.toHaveURL(/unlock/);
});

test("the shelf shows the sections, and a series opens with its episodes", async ({ page }) => {
  await unlock(page);
  try {
    await expect(page.getByText("Recent hits · 2015 to now")).toBeVisible({ timeout: 30_000 });
    for (const chip of ["Tamil films", "Hollywood in Tamil", "Korean in Tamil", "Other Indian languages", "World cinema", "Anime series", "Kids cartoons"]) {
      await expect(page.getByRole("button", { name: chip, exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "Kids cartoons", exact: true }).click();
    await expect(page.getByText("Cartoons for kids, in Tamil")).toBeVisible();
    await page.locator("button.group").first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Episodes")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Start with episode 1/ })).toBeVisible();
    await page.keyboard.press("Escape").catch(() => {});
    await page.getByPlaceholder("Search films").fill("mayabazar");
    await expect(page.getByText("Results for")).toBeVisible();
  } finally {
    await page.request.delete("/api/unlock").catch(() => {});
  }
});

test("a friend joins by link and chat, play and seek stay in step", async ({ browser }) => {
  test.setTimeout(150_000);
  const probe = await browser.newPage();
  test.skip(!(await brokerUp(probe)), "PeerJS's broker can't be reached from here");
  await probe.close();
  const { host, guest, close } = await twoInOneRoom(browser, classic.id);
  try {
    await host.getByPlaceholder("Say something…").fill("hello from the host");
    await host.keyboard.press("Enter");
    await expect(guest.getByText("hello from the host")).toBeVisible({ timeout: 20_000 });
    await guest.getByPlaceholder("Say something…").fill("hi from Priya");
    await guest.keyboard.press("Enter");
    await expect(host.getByText("hi from Priya")).toBeVisible({ timeout: 20_000 });

    const state = (p: Page) => p.evaluate(() => { const v = document.querySelector("video")!; return { paused: v.paused, t: v.currentTime }; });
    await host.evaluate(() => { const v = document.querySelector("video")!; v.muted = true; return v.play(); });
    await expect.poll(async () => (await state(guest)).paused, { timeout: 20_000 }).toBe(false);
    await host.evaluate(() => { document.querySelector("video")!.currentTime = 600; });
    await expect.poll(async () => Math.round((await state(guest)).t / 50), { timeout: 20_000 }).toBeGreaterThanOrEqual(12); // ~600 s
    await host.evaluate(() => document.querySelector("video")!.pause());
    await expect.poll(async () => (await state(guest)).paused, { timeout: 20_000 }).toBe(true);
  } finally {
    await close();
  }
});

test("a YouTube film loads in YouTube's player", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`/theatre/${room()}?m=${youtube.id}&host=1`);
  await p.getByRole("button", { name: /Open the room/ }).click();
  await expect(p.getByPlaceholder("Say something…")).toBeVisible({ timeout: 40_000 });
  await expect(p.locator("iframe[src*='youtube.com/embed']")).toHaveCount(1, { timeout: 30_000 });
  await expect(p.getByText(/won.t play this one here/)).toHaveCount(0);
  await ctx.close();
});

test("a film YouTube won't embed gets the start-together countdown", async ({ browser }) => {
  test.setTimeout(150_000);
  const probe = await browser.newPage();
  test.skip(!(await brokerUp(probe)), "PeerJS's broker can't be reached from here");
  await probe.close();
  const { host, guest, close } = await twoInOneRoom(browser, sony.id);
  try {
    await expect(guest.getByRole("link", { name: "Open on YouTube" })).toBeVisible();
    await host.getByRole("button", { name: "Start together" }).click();
    await expect(guest.getByText(/started the countdown/)).toBeVisible({ timeout: 20_000 });
    await expect(guest.locator("p.text-7xl")).toBeVisible();
  } finally {
    await close();
  }
});

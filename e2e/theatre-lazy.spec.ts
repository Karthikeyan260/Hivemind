import { expect, test, type Browser } from "@playwright/test";
import { MOVIES } from "../lib/theatre/catalog";

/**
 * A friend opening a room link must get in quickly even when the big film list is slow to arrive (a slow phone): joining
 * does not wait for it. The room knows only the film named in the link until the list has loaded; then it catches up with
 * what the opener is watching on its own. These tests hold the list back for 10 seconds to prove both. They need PeerJS's
 * free broker and skip without it.
 */
test.skip(({ isMobile }) => isMobile, "these tests drive several desktop browsers");

const room = () => Math.random().toString(16).slice(2, 14).padEnd(12, "a");
const openersFilm = MOVIES.find((m) => m.id === "mayabazar")!;
const friendsLink = MOVIES.find((m) => !m.yt && m.id !== "mayabazar")!; // another public-domain film
const BOX = "Say something…";
const HOLD_MS = 10_000;

async function needBroker(browser: Browser) {
  const ctx = await browser.newContext();
  let ok = false;
  for (let i = 0; i < 3 && !ok; i++) ok = await ctx.request.get("https://0.peerjs.com/", { timeout: 10_000 }).then((r) => r.ok(), () => false);
  await ctx.close();
  test.skip(!ok, "PeerJS's broker can't be reached from here");
}

test("a friend gets into the room before the film list has arrived, then follows the opener's film", async ({ browser }) => {
  test.setTimeout(180_000);
  await needBroker(browser);
  const code = room();

  // The opener, with a normal connection.
  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  await host.goto(`/theatre/${code}?m=${openersFilm.id}&host=1`);
  await host.locator("#nm").fill("Host");
  await host.getByRole("button", { name: /Open the room/ }).click();
  await expect(host.locator("aside").getByText(/The room is open/)).toBeVisible({ timeout: 60_000 });

  // The friend, on a connection where the big script (the film list) takes ten extra seconds.
  const friendCtx = await browser.newContext();
  const friend = await friendCtx.newPage();
  let held = 0;
  await friend.route(/\/_next\/static\/.*\.js/, async (route) => {
    const res = await route.fetch();
    const body = await res.body();
    if (body.length > 2_000_000) {
      held++;
      await new Promise((r) => setTimeout(r, HOLD_MS));
    }
    await route.fulfill({ response: res, body });
  });
  await friend.goto(`/theatre/${code}?m=${friendsLink.id}`);
  await friend.locator("#nm").fill("Priya");
  const t0 = Date.now();
  await friend.getByRole("button", { name: /Join the screening/ }).click();
  // In the room (connected to the opener) long before the film list can have arrived.
  await expect(friend.locator("aside").getByText("Host joined")).toBeVisible({ timeout: 60_000 });
  const took = Date.now() - t0;
  expect(held, "the film list really was held back").toBeGreaterThan(0);
  expect(took, `joined after ${took} ms: it must not wait for the film list`).toBeLessThan(HOLD_MS - 2000);
  await expect(host.locator("aside").getByText("Priya joined")).toBeVisible({ timeout: 30_000 });

  // Until the list arrives the friend is still on the film from their link...
  await expect(friend.locator("header").getByText(friendsLink.title)).toBeVisible();
  // ...then the room catches up: the opener's film replaces it, with no action from the friend.
  await expect(friend.locator("header").getByText(openersFilm.title)).toBeVisible({ timeout: 60_000 });

  // And the room works both ways afterwards.
  await host.getByPlaceholder(BOX).fill("welcome");
  await host.keyboard.press("Enter");
  await expect(friend.getByText("welcome", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await Promise.all([hostCtx.close(), friendCtx.close()]);
});

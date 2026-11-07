import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { MOVIES } from "../lib/theatre/catalog";

/**
 * Friends Theatre's one permanent room link: it keeps working however people come and go. The link is the same for
 * everyone, whoever opens it first holds the room, and if that person leaves a friend takes the room over. These tests
 * leave and come back in every order (a friend, the opener, everyone) and check that chat still flows both ways and
 * that the film keeps its place. They need PeerJS's free broker and skip without it.
 */
test.skip(({ isMobile }) => isMobile, "these tests drive several desktop browsers");

const room = () => Math.random().toString(16).slice(2, 14);
const film = MOVIES.find((m) => m.id === "mayabazar")!;
const BOX = "Say something…";
const T = 60_000;

async function needBroker(browser: Browser) {
  const ctx = await browser.newContext();
  let ok = false;
  for (let i = 0; i < 3 && !ok; i++) ok = await ctx.request.get("https://0.peerjs.com/", { timeout: 10_000 }).then((r) => r.ok(), () => false);
  await ctx.close();
  test.skip(!ok, "PeerJS's broker can't be reached from here");
}

type Person = { name: string; ctx: BrowserContext; page: Page };

/** Opens the permanent link in a fresh browser (its own login-free session) and walks through the join screen. */
async function arrive(browser: Browser, code: string, name: string, query = ""): Promise<Person> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  if (process.env.E2E_DEBUG) await page.addInitScript(() => ((window as unknown as { __theatreDebug: boolean }).__theatreDebug = true));
  // E2E_DEBUG=1 prints what each browser logs and when its tab goes away (to see why a rejoin failed).
  if (process.env.E2E_DEBUG) {
    page.on("console", (m) => console.log(`[${name}] ${m.type()}: ${m.text().slice(0, 200)}`));
    page.on("pageerror", (e) => console.log(`[${name}] pageerror: ${String(e).slice(0, 200)}`));
    page.on("close", () => console.log(`[${name}] tab closed`));
  }
  await page.goto(`/theatre/${code}${query}`);
  await page.locator("#nm").fill(name);
  await page.getByRole("button", { name: /Open the room|Join the screening/ }).click();
  await expect(page.getByPlaceholder(BOX)).toBeVisible({ timeout: T });
  // The chat box is there as soon as "join" is pressed, before the room is really open or connected. Wait for the real
  // thing, or two people arriving one after the other can race for the room and the first one may not be the opener.
  await expect(page.locator("aside").getByText(/The room is open|You are running the room now|\bjoined$/).first()).toBeVisible({ timeout: T });
  const person = { name, ctx, page };
  everyone.add(person);
  return person;
}

/** Leaves the way people do: the tab is closed (the room hears it at once). */
const leave = async (p: Person) => {
  await p.page.close();
  await p.ctx.close();
};

async function say(p: Person, text: string) {
  await p.page.getByPlaceholder(BOX).fill(text);
  await p.page.keyboard.press("Enter");
}
const everyone = new Set<Person>();
async function hears(p: Person, text: string) {
  try {
    await expect(p.page.getByText(text, { exact: true }).first()).toBeVisible({ timeout: T });
  } catch (e) {
    if (process.env.E2E_DEBUG) for (const q of everyone) console.log(`--- ${q.name}'s chat ---\n${await q.page.locator("aside").innerText().catch(() => "(closed)")}`);
    throw e;
  }
}

/** Chat works in both directions between two people who are in the room. */
async function talk(a: Person, b: Person, tag: string) {
  // Wait until each one's header lists the other: that means they are connected (a "joined" line may be left over from an earlier visit).
  try {
    await expect(a.page.locator("header").getByText(new RegExp(`You, .*\\b${b.name}\\b`))).toBeVisible({ timeout: T });
    await expect(b.page.locator("header").getByText(new RegExp(`You, .*\\b${a.name}\\b`))).toBeVisible({ timeout: T });
  } catch (e) {
    if (process.env.E2E_DEBUG) for (const q of everyone) console.log(`--- ${q.name}: header "${await q.page.locator("header").innerText().catch(() => "(closed)")}"`);
    throw e;
  }
  await say(a, `${tag} from ${a.name}`);
  await hears(b, `${tag} from ${a.name}`);
  await say(b, `${tag} from ${b.name}`);
  await hears(a, `${tag} from ${b.name}`);
}

const seen = (p: Person) => p.page.evaluate(() => ({ t: document.querySelector("video")?.currentTime ?? -1, paused: document.querySelector("video")?.paused ?? true }));

test.describe("one permanent room link", () => {
  test.beforeEach(async ({ browser }) => needBroker(browser));

  test("a friend leaves and joins again with the same link", async ({ browser }) => {
    test.setTimeout(240_000);
    const code = room();
    const host = await arrive(browser, code, "Host", `?m=${film.id}&host=1`);
    let priya = await arrive(browser, code, "Priya", `?m=${film.id}`);
    await expect(host.page.getByText("Priya joined")).toBeVisible({ timeout: T });
    await talk(host, priya, "first");

    await leave(priya);
    await expect(host.page.getByText("Priya left")).toBeVisible({ timeout: T });

    priya = await arrive(browser, code, "Priya", `?m=${film.id}`);
    await expect(host.page.getByText("Priya joined")).toHaveCount(2, { timeout: T });
    await talk(host, priya, "second");
    await Promise.all([host.ctx.close(), priya.ctx.close()]);
  });

  test("the opener leaves, a friend takes the room over, and the opener comes back with the same link", async ({ browser }) => {
    test.setTimeout(300_000);
    const code = room();
    let host = await arrive(browser, code, "Host", `?m=${film.id}&host=1`);
    const priya = await arrive(browser, code, "Priya", `?m=${film.id}`);
    await expect(host.page.getByText("Priya joined")).toBeVisible({ timeout: T });

    await leave(host);
    await expect(priya.page.getByText("Host left")).toBeVisible({ timeout: T });
    // The friend now runs the room.
    await expect(priya.page.getByText(/You are running the room now/)).toBeVisible({ timeout: 90_000 });

    // The original opener returns by the very same link: they join the friend's room.
    host = await arrive(browser, code, "Host", `?m=${film.id}&host=1`);
    await expect(priya.page.getByText("Host joined")).toHaveCount(2, { timeout: T }); // once the first time, once on returning
    await expect(host.page.getByText(/The room is open/)).toHaveCount(0);
    await talk(host, priya, "back");
    await Promise.all([host.ctx.close(), priya.ctx.close()]);
  });

  test("a newcomer can still join after the opener has gone", async ({ browser }) => {
    test.setTimeout(300_000);
    const code = room();
    const host = await arrive(browser, code, "Host", `?m=${film.id}&host=1`);
    const priya = await arrive(browser, code, "Priya", `?m=${film.id}`);
    await expect(host.page.getByText("Priya joined")).toBeVisible({ timeout: T });
    await leave(host);
    await expect(priya.page.getByText(/You are running the room now/)).toBeVisible({ timeout: 90_000 });

    const ravi = await arrive(browser, code, "Ravi", `?m=${film.id}`);
    await expect(priya.page.getByText("Ravi joined")).toBeVisible({ timeout: T });
    await talk(priya, ravi, "late");
    await Promise.all([priya.ctx.close(), ravi.ctx.close()]);
  });

  test("with three in the room, the opener leaving doesn't split the others", async ({ browser }) => {
    test.setTimeout(300_000);
    const code = room();
    const host = await arrive(browser, code, "Host", `?m=${film.id}&host=1`);
    const priya = await arrive(browser, code, "Priya", `?m=${film.id}`);
    const ravi = await arrive(browser, code, "Ravi", `?m=${film.id}`);
    await expect(host.page.getByText("Ravi joined")).toBeVisible({ timeout: T });
    await expect(priya.page.getByText("Ravi joined")).toBeVisible({ timeout: T }); // the friends are connected to each other too
    await expect(ravi.page.getByText("Priya joined")).toBeVisible({ timeout: T });
    await talk(priya, ravi, "three");

    await leave(host);
    await expect(priya.page.getByText("Host left")).toBeVisible({ timeout: T });
    // Give the friends time to settle on one new opener, then they must still hear each other, and a latecomer too.
    await expect.poll(async () => (await priya.page.getByText(/You are running the room now/).count()) + (await ravi.page.getByText(/You are running the room now/).count()), { timeout: 90_000 }).toBeGreaterThanOrEqual(1);
    await talk(priya, ravi, "still three");
    const mala = await arrive(browser, code, "Mala", `?m=${film.id}`);
    await expect(priya.page.getByText("Mala joined")).toBeVisible({ timeout: T });
    await expect(mala.page.getByText(/Priya joined|Ravi joined/).first()).toBeVisible({ timeout: T });
    await talk(mala, priya, "latecomer");
    await Promise.all([priya.ctx.close(), ravi.ctx.close(), mala.ctx.close()]);
  });

  test("when everyone has left, the same link opens the room again", async ({ browser }) => {
    test.setTimeout(240_000);
    const code = room();
    const host = await arrive(browser, code, "Host", `?m=${film.id}&host=1`);
    const priya = await arrive(browser, code, "Priya", `?m=${film.id}`);
    await expect(host.page.getByText("Priya joined")).toBeVisible({ timeout: T });
    await Promise.all([leave(host), leave(priya)]);
    // The broker frees the room's id as the tabs close; the link then opens a fresh room.
    await new Promise((r) => setTimeout(r, 4000));
    const again = await arrive(browser, code, "Host", `?m=${film.id}&host=1`);
    // Usually at once; if the broker still holds the old room id for a few seconds, a moment later by taking the room over.
    await expect(again.page.getByText(/The room is open|You are running the room now/)).toBeVisible({ timeout: 90_000 });
    const friend = await arrive(browser, code, "Priya", `?m=${film.id}`);
    await expect(again.page.getByText("Priya joined")).toBeVisible({ timeout: T });
    await talk(again, friend, "fresh");
    await Promise.all([again.ctx.close(), friend.ctx.close()]);
  });

  test("the film keeps its place when the opener leaves and comes back", async ({ browser }) => {
    test.setTimeout(300_000);
    const code = room();
    let host = await arrive(browser, code, "Host", `?m=${film.id}&host=1`);
    const priya = await arrive(browser, code, "Priya", `?m=${film.id}`);
    await expect(host.page.getByText("Priya joined")).toBeVisible({ timeout: T });
    // Jump to about 10 minutes on the opener; the friend follows.
    await host.page.evaluate(() => {
      const v = document.querySelector("video");
      if (v) {
        v.muted = true;
        v.currentTime = 600;
      }
    });
    await expect.poll(async () => Math.round((await seen(priya)).t / 60), { timeout: T }).toBe(10);

    await leave(host);
    await expect(priya.page.getByText(/You are running the room now/)).toBeVisible({ timeout: 90_000 });
    host = await arrive(browser, code, "Host", `?m=${film.id}&host=1`);
    // The returning opener is put where the film is, not at the start, and the friend isn't dragged back to 0:00.
    await expect.poll(async () => Math.round((await seen(host)).t / 60), { timeout: T }).toBe(10);
    await new Promise((r) => setTimeout(r, 10_000));
    expect(Math.round((await seen(priya)).t / 60)).toBe(10);
    await Promise.all([host.ctx.close(), priya.ctx.close()]);
  });
});

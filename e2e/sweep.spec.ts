import * as fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../playwright.config";

/**
 * Health sweep (`npm run test:sweep`): opens every page signed in, on desktop and phone, and records
 * what a person would notice: crashes, error messages, failed requests, console errors, sideways
 * scrolling on a phone. Reads only; nothing is created. Screenshots and a JSON report go to
 * test-results/sweep/.
 */
test.skip(!process.env.SWEEP && process.env.npm_lifecycle_event !== "test:sweep", "run with npm run test:sweep");

const PAGES = ["/", "/projects", "/memories", "/notes", "/documents", "/search", "/career", "/journey", "/habits", "/routines", "/apps", "/autopilot", "/brief", "/dream", "/comic", "/calls", "/web", "/map", "/share", "/focus", "/games", "/games/paattu", "/games/draw", "/sources", "/settings"];
// Things that aren't faults: the browser refusing permissions in a headless run, media streams.
const IGNORE = /favicon|Permission|NotAllowedError|geolocation|getUserMedia|AbortError|ERR_ABORTED|net::ERR_FAILED.*(stream|music)|Failed to load resource: the server responded with a status of 401/i;

type Finding = { page: string; device: string; kind: string; detail: string };
const findings: Finding[] = [];
const OUT = "test-results/sweep";

async function unlock(page: Page) {
  await page.goto("/unlock");
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page).not.toHaveURL(/\/unlock/, { timeout: 20_000 });
}

test.afterAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
  const file = `${OUT}/report-${test.info().project.name}.json`;
  fs.writeFileSync(file, JSON.stringify(findings, null, 2));
});

test("every page opens cleanly", async ({ page }, info) => {
  test.setTimeout(PAGES.length * 30_000);
  const device = info.project.name;
  await unlock(page);
  // Pages with an id: the first project and app, if any.
  const projects = await (await page.request.get("/api/projects")).json().catch(() => []);
  const apps = await (await page.request.get("/api/apps")).json().catch(() => ({ apps: [] }));
  const list = [...PAGES];
  const pid = (Array.isArray(projects) ? projects : projects.projects ?? [])[0]?.id;
  if (pid) list.push(`/projects/${pid}`);
  const aid = apps.apps?.find((a: { status: string }) => a.status === "ready")?.id;
  if (aid) list.push(`/apps/${aid}`);

  for (const path of list) {
    const here = (kind: string, detail: string) => !IGNORE.test(detail) && findings.push({ page: path, device, kind, detail: detail.slice(0, 300) });
    const onConsole = (m: { type(): string; text(): string }) => m.type() === "error" && here("console", m.text());
    const onError = (e: Error) => here("crash", e.message);
    const onResponse = (r: { status(): number; url(): string; request(): { method(): string } }) => {
      const u = new URL(r.url());
      if (r.status() >= 400 && u.host === new URL(page.url() || "http://x").host) here("http", `${r.request().method()} ${u.pathname}${u.search} → ${r.status()}`);
    };
    const onFailed = (r: { url(): string; failure(): { errorText: string } | null }) => here("network", `${r.url().slice(0, 120)} ${r.failure()?.errorText ?? ""}`);
    page.on("console", onConsole);
    page.on("pageerror", onError);
    page.on("response", onResponse);
    page.on("requestfailed", onFailed);
    const t0 = Date.now();
    try {
      await page.goto(path, { waitUntil: "load", timeout: 25_000 });
      await page.waitForTimeout(2500); // let data load and effects run
      const ms = Date.now() - t0;
      if (ms > 9000) here("slow", `${ms} ms to load`);
      if (page.url().includes("/unlock")) here("locked", "bounced to /unlock while signed in");
      const body = await page.locator("body").innerText();
      for (const bad of ["Application error", "Something went wrong", "Unhandled Runtime Error", "This page could not be found", "Internal Server Error"]) if (body.includes(bad)) here("screen", `shows "${bad}"`);
      // Red error text the app shows (ErrorText renders in text-alert).
      const errs = (await page.locator("p.text-alert, [role=alert]").allInnerTexts()).map((x) => x ?? "");
      for (const e of errs.filter((x) => x.trim() && x.length < 300)) here("screen", `error text: ${e.trim()}`);
      if (device === "phone") {
        const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (wide > 4) here("layout", `scrolls sideways by ${wide}px on a phone`);
      }
      await page.screenshot({ path: `${OUT}/${device}${path.replace(/\//g, "_") || "_home"}.png` });
    } catch (e) {
      here("load", e instanceof Error ? e.message.split("\n")[0] : String(e));
    } finally {
      page.off("console", onConsole);
      page.off("pageerror", onError);
      page.off("response", onResponse);
      page.off("requestfailed", onFailed);
    }
  }
  await page.request.delete("/api/unlock");
});

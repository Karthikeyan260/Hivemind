import "server-only";
import type { Browser, Page } from "playwright-core";
import { cdpUrl } from "./steel";

/**
 * What the agent "sees": the page's visible interactive elements, numbered, plus its readable text.
 * Numbers are written onto the elements (data-hm) so the next action can find them again.
 */
export type Snapshot = { url: string; title: string; elements: string; text: string };

export async function attach(sessionId: string): Promise<{ browser: Browser; page: Page }> {
  // Loaded only when a task runs: routes that merely import the web agent (the scheduler) never need it.
  const { chromium } = await import("playwright-core");
  const browser = await chromium.connectOverCDP(cdpUrl(sessionId), { timeout: 20_000 });
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const pages = context.pages();
  const page = pages[pages.length - 1] ?? (await context.newPage());
  page.setDefaultTimeout(8000);
  return { browser, page };
}

/**
 * Runs inside the page. Plain JavaScript in a string, so no bundler helper can sneak into it.
 */
const READ_PAGE = String.raw`(() => {
  var clean = function (s, n) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, n || 80); };
  var visible = function (el) {
    var r = el.getBoundingClientRect();
    var s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none" && r.bottom > -50 && r.top < innerHeight * 2.5;
  };
  document.querySelectorAll("[data-hm]").forEach(function (e) { e.removeAttribute("data-hm"); });
  var SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=combobox],[role=switch],[contenteditable="true"]';
  var lines = [];
  var n = 0;
  var all = document.querySelectorAll(SEL);
  for (var i = 0; i < all.length && n < 160; i++) {
    var el = all[i];
    if (!visible(el)) continue;
    var tag = el.tagName.toLowerCase();
    var type = el.getAttribute("type");
    var role = el.getAttribute("role");
    var label = clean(el.labels && el.labels[0] && el.labels[0].innerText) || clean(el.getAttribute("aria-label")) || clean(el.getAttribute("placeholder")) || clean(el.getAttribute("name"), 40) || clean(el.getAttribute("title"));
    var img = el.querySelector("img");
    var text = (tag === "input" || tag === "select" || tag === "textarea") ? "" : (clean(el.innerText) || clean(el.getAttribute("aria-label")) || clean(el.getAttribute("title")) || clean(img && img.getAttribute("alt")));
    if (!label && !text && tag === "a") continue;
    n++;
    el.setAttribute("data-hm", String(n));
    var line = "[" + n + "] " + tag + (type ? "[" + type + "]" : "") + (role ? "(" + role + ")" : "");
    if (text) line += ' "' + text + '"';
    if (label && label !== text) line += ' label="' + label + '"';
    if (tag === "select") line += " options=" + JSON.stringify(Array.prototype.slice.call(el.options, 0, 10).map(function (o) { return clean(o.text, 30); }));
    if ((tag === "input" || tag === "textarea") && type !== "password" && el.value) line += ' value="' + clean(el.value, 40) + '"';
    if (type === "checkbox" || type === "radio") line += el.checked ? " (checked)" : " (unchecked)";
    if (el.disabled) line += " (disabled)";
    if (tag === "a") {
      var href = el.getAttribute("href") || "";
      if (href && href.indexOf("javascript") !== 0) line += " -> " + clean(href, 60);
    }
    lines.push(line);
  }
  var body = document.body ? document.body.innerText : "";
  var txt = body.replace(/\n{2,}/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, 3500);
  return { url: location.href, title: document.title, elements: lines.join("\n"), text: txt };
})()`;

export async function snapshot(page: Page): Promise<Snapshot> {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  return page.evaluate<Snapshot>(READ_PAGE);
}

export async function screenshot(page: Page) {
  return page.screenshot({ type: "jpeg", quality: 45, timeout: 8000 }).catch(() => null);
}

/** The visible name of element [ref], for the approval check and the step log. */
export async function describe(page: Page, ref: number) {
  return page
    .locator(`[data-hm="${ref}"]`)
    .first()
    .evaluate((el) => {
      const h = el as HTMLElement & { value?: string };
      return `${el.tagName.toLowerCase()} "${(h.innerText || h.value || el.getAttribute("aria-label") || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 60)}"${el.getAttribute("type") ? ` type=${el.getAttribute("type")}` : ""}`;
    })
    .catch(() => null);
}

export type Action =
  | { type: "goto"; url: string }
  | { type: "click"; ref: number }
  | { type: "type"; ref: number; text: string; enter?: boolean }
  | { type: "select"; ref: number; option: string }
  | { type: "scroll"; direction: "up" | "down" }
  | { type: "back" }
  | { type: "wait" };

/** Does one browser action; throws a short readable error if it can't. */
export async function act(page: Page, a: Action) {
  const el = "ref" in a ? page.locator(`[data-hm="${a.ref}"]`).first() : null;
  switch (a.type) {
    case "goto": {
      const url = /^https?:\/\//.test(a.url) ? a.url : `https://${a.url}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      break;
    }
    case "click":
      await el!.scrollIntoViewIfNeeded().catch(() => {});
      await el!.click({ timeout: 6000 });
      break;
    case "type":
      await el!.fill(a.text, { timeout: 6000 }).catch(async () => {
        await el!.click({ timeout: 4000 });
        await page.keyboard.type(a.text, { delay: 15 });
      });
      // Through the keyboard: suggestion dropdowns often replace the field as you type.
      if (a.enter) await page.keyboard.press("Enter");
      break;
    case "select":
      await el!.selectOption({ label: a.option }, { timeout: 6000 }).catch(() => el!.selectOption(a.option, { timeout: 6000 }));
      break;
    case "scroll":
      await page.mouse.wheel(0, a.direction === "up" ? -700 : 700);
      break;
    case "back":
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 });
      break;
    case "wait":
      await page.waitForTimeout(2500);
      break;
  }
  // Let navigation / client-side rendering settle before the next look.
  await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700);
}

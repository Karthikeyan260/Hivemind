/**
 * Voice can use any page the way a person would: scroll, click a button or link by its label, type
 * into a field, pick from a dropdown. Everything works from the visible labels, so new pages and
 * buttons are usable by voice without registering anything.
 */

type R = Record<string, unknown>;

const CLICKABLE = "button, a[href], [role=button], [role=tab], [role=link], [role=menuitem], [role=option], summary, label, input[type=checkbox], input[type=radio]";
const FIELDS = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, [contenteditable=true]";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

function visible(el: Element) {
  const h = el as HTMLElement;
  if (!h.getClientRects().length) return false;
  const st = getComputedStyle(h);
  return st.visibility !== "hidden" && st.display !== "none" && !h.closest("[aria-hidden=true], [inert]");
}

function labelOf(el: Element) {
  const h = el as HTMLElement;
  const byFor = h.id ? document.querySelector(`label[for="${CSS.escape(h.id)}"]`)?.textContent : "";
  return clean(
    h.getAttribute("aria-label") ||
      byFor ||
      (h.closest("label") as HTMLElement | null)?.innerText ||
      h.innerText ||
      h.getAttribute("title") ||
      h.getAttribute("placeholder") ||
      (h as HTMLInputElement).value ||
      h.getAttribute("name"),
  ).slice(0, 80);
}

/** Best label match: exact > starts with > contains > most shared words. */
function best<T extends Element>(els: T[], query: string, label = labelOf): T | null {
  const q = norm(query);
  if (!q) return null;
  const words = q.split(" ");
  let top: T | null = null;
  let topScore = 0;
  for (const el of els) {
    const l = norm(label(el));
    if (!l) continue;
    const score = l === q ? 100 : l.startsWith(q) ? 60 : l.includes(q) ? 40 : (words.filter((w) => l.includes(w)).length / words.length) * 30;
    if (score > topScore) [top, topScore] = [el, score];
  }
  return topScore >= 15 ? top : null;
}

const all = <T extends Element>(sel: string) => [...document.querySelectorAll<T>(sel)].filter(visible);

/** What a person could click, type into or choose on this page right now. */
export function listControls() {
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  return {
    buttons_and_links: uniq(all(CLICKABLE).map(labelOf)).slice(0, 60),
    fields: uniq(all(FIELDS).map(labelOf)).slice(0, 20),
    dropdowns: all<HTMLSelectElement>("select").map((s) => ({ name: labelOf(s), current: s.selectedOptions[0]?.text ?? "", options: [...s.options].map((o) => o.text).slice(0, 25) })),
  };
}

const DESTRUCTIVE = /\b(delete|remove|erase|discard|clear|reset|replace|unlink|revoke)\b/i;

export function click({ target, confirmed }: R): R {
  const el = best(all<HTMLElement>(CLICKABLE), String(target ?? ""));
  if (!el) return { error: `Nothing on this page is labelled "${target}".`, available: listControls().buttons_and_links.slice(0, 30) };
  if (DESTRUCTIVE.test(labelOf(el)) && confirmed !== true)
    return { needs_confirmation: true, button: labelOf(el), note: "This button deletes or replaces something. Ask the owner first; call click again with confirmed=true only after they say yes." };
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.focus({ preventScroll: true });
  el.click();
  return { clicked: labelOf(el) };
}

/** The element that actually scrolls: the page, or the biggest scrolling panel on screen. */
function scroller(): HTMLElement {
  const root = document.scrollingElement as HTMLElement;
  let pick = root;
  let area = root.scrollHeight > root.clientHeight + 20 ? window.innerWidth * window.innerHeight : 0;
  for (const el of document.querySelectorAll<HTMLElement>("main *, body > div *")) {
    if (el.scrollHeight <= el.clientHeight + 20) continue;
    const oy = getComputedStyle(el).overflowY;
    if (oy !== "auto" && oy !== "scroll") continue;
    const r = el.getBoundingClientRect();
    const a = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    if (a > area) [pick, area] = [el, a];
  }
  return pick;
}

export function scroll({ direction, to, amount }: R): R {
  const text = String(to ?? "").trim();
  if (text) {
    // Scroll a heading / section / item with this text into view.
    const hit = best(all<HTMLElement>("h1, h2, h3, h4, section, article, li, [id], p, button, a"), text, (e) => clean((e as HTMLElement).innerText).slice(0, 120));
    if (!hit) return { error: `Couldn't find "${text}" on this page.` };
    hit.scrollIntoView({ block: "start", behavior: "smooth" });
    return { scrolled_to: clean(hit.innerText).slice(0, 60) };
  }
  const el = scroller();
  const d = String(direction ?? "down").toLowerCase();
  const page = el.clientHeight * 0.8 * Math.max(0.25, Math.min(5, Number(amount) || 1));
  const top = /top|start|beginning/.test(d) ? 0 : /bottom|end/.test(d) ? el.scrollHeight : el.scrollTop + (/up/.test(d) ? -page : page);
  el.scrollTo({ top, behavior: "smooth" });
  const pct = Math.round((Math.max(0, Math.min(top, el.scrollHeight - el.clientHeight)) / Math.max(1, el.scrollHeight - el.clientHeight)) * 100);
  return { scrolled: d, position_percent: pct };
}

/** React ignores plain .value writes; use the native setter so onChange fires. */
function setNative(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

export function typeText({ field, text, submit }: R): R {
  const fields = all<HTMLElement>(FIELDS);
  const el = (field ? best(fields, String(field)) : null) ?? (!field ? ((document.activeElement?.matches(FIELDS) ? document.activeElement : fields[0]) as HTMLElement | null) : null);
  if (!el) return { error: `No field called "${field}" here.`, fields: listControls().fields };
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.focus({ preventScroll: true });
  if (el.isContentEditable) el.innerText = String(text ?? "");
  else setNative(el as HTMLInputElement, String(text ?? ""));
  if (submit) {
    const form = el.closest("form");
    if (form) form.requestSubmit();
    else el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  }
  return { typed_into: labelOf(el) || "field", submitted: !!submit };
}

export function selectOption({ field, option }: R): R {
  const selects = all<HTMLSelectElement>("select");
  const want = String(option ?? "");
  // Match the dropdown by its label, or else by which one has the requested option.
  const el =
    (field ? best(selects, String(field), (s) => `${labelOf(s)} ${(s as HTMLSelectElement).selectedOptions[0]?.text ?? ""}`) : null) ??
    selects.find((s) => best([...s.options], want, (o) => (o as HTMLOptionElement).text));
  if (!el) return { error: "No matching dropdown on this page.", dropdowns: listControls().dropdowns };
  const opt = best([...el.options], want, (o) => (o as HTMLOptionElement).text);
  if (!opt) return { error: `"${want}" isn't an option.`, options: [...el.options].map((o) => o.text) };
  setNative(el, opt.value);
  return { selected: opt.text, in: labelOf(el) };
}

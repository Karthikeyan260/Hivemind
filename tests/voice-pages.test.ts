import { readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { GROUPS } from "@/lib/voice/plan";
import { VOICE_PAGE_PATHS } from "@/lib/voice/pages";

/** Every app page that has no [id] in it (those need a specific item, and voice opens them through tools). */
function appPages(dir = join(process.cwd(), "app"), base = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) {
      if (name === "page.tsx") out.push(base || "/");
      continue;
    }
    if (name === "api" || name.startsWith("[")) continue;
    // Route groups like (app) don't add to the path.
    out.push(...appPages(full, name.startsWith("(") ? base : `${base}/${name}`));
  }
  return out;
}
// Pages voice shouldn't open: the lock screen, and the call / play-with-a-friend landing pages.
const NOT_FOR_VOICE = ["/unlock", "/share-in"];

describe("voice can open every page", () => {
  it("lists every app page, and only real ones", () => {
    const pages = appPages().filter((p) => !NOT_FOR_VOICE.includes(p));
    const bases = new Set(VOICE_PAGE_PATHS.map((p) => p.split("?")[0]));
    for (const p of pages) expect(bases, `voice can't open ${p}`).toContain(p);
    for (const p of bases) expect(pages, `voice lists ${p}, which isn't a page`).toContain(p);
  });
  it("every page the voice instructions send to is allowed", () => {
    const text = Object.values(GROUPS)
      .flatMap((g) => g.guide.map((x) => (typeof x === "function" ? x({ routines: "" }) : x)))
      .join("\n");
    const named = [...text.matchAll(/navigate (\/[a-z0-9/?=]*)/g)].map((m) => m[1].replace(/[.,)]+$/, "")).filter((p) => p.length > 1 || p === "/");
    expect(named.length).toBeGreaterThan(5);
    for (const p of named) expect(VOICE_PAGE_PATHS, `instructions say "navigate ${p}"`).toContain(p);
  });
});

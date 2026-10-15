import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * Source files must not contain invisible control characters. A regex like /\b503\b/ written through
 * a shell can arrive as a backspace character instead of "\b": it still compiles, but never matches.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "node_modules" || f.startsWith(".") ? [] : files(p);
    return /\.(ts|tsx|css|mjs|cjs|js)$/.test(f) ? [p] : [];
  });
}

describe("source files", () => {
  it("have no stray control characters (a mangled \\b in a regex)", () => {
    const bad = ["lib", "components", "app", "tests"]
      .flatMap((d) => files(d))
      // Tab, newline and carriage return are fine; anything else below space is not.
      .filter((f) => /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});

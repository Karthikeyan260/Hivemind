import { describe, expect, it } from "vitest";
import { snapshotName } from "@/lib/garden-snapshot";

describe("snapshotName", () => {
  it("makes a plain file name from the pet and the day", () => {
    expect(snapshotName("Nova", "2026-10-22")).toBe("nova-garden-2026-10-22.png");
    expect(snapshotName("Sparky The 2nd!", "2026-10-22")).toBe("sparky-the-2nd-garden-2026-10-22.png");
  });
  it("falls back when the name has no letters or digits", () => {
    expect(snapshotName("✨", "2026-10-22")).toBe("my-garden-2026-10-22.png");
  });
});

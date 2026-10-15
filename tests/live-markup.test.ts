import { describe, expect, it } from "vitest";
import { stripMarkup } from "@/lib/live";

describe("stripMarkup (live voice transcript)", () => {
  it("drops the model's markup, keeps real words", () => {
    expect(stripMarkup("<no speech>{pause}")).toBe("");
    expect(stripMarkup("Nova is here! {pause} Want to play?")).toBe("Nova is here!  Want to play?");
    expect(stripMarkup("<noise> hello [silence]")).toBe(" hello ");
    expect(stripMarkup("x < y and {name}")).toBe("x < y and {name}");
  });
});

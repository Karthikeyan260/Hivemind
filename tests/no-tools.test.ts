import { describe, expect, it } from "vitest";
import { asksForAction } from "@/lib/ai/no-tools";

describe("asksForAction (chat fallback without tools)", () => {
  it("catches requests to do something", () => {
    for (const m of ["rename my pet to Sparky", "play Vaathi Coming", "please remind me at 6 pm", "can you save this note", "Nova, hide", "set an alarm for 7", "delete my gym habit", "call Amma"]) expect(asksForAction(m), m).toBe(true);
  });
  it("lets questions through", () => {
    for (const m of ["what is a kural?", "how is the weather in Chennai", "who directed Jailer", "tell me about my projects", "why is the sky blue"]) expect(asksForAction(m), m).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { quickEffect } from "@/lib/agents/quick";

const fx = (m: string) => quickEffect(m)?.args ?? null;

describe("quick screen switches (no AI)", () => {
  it("music lights and weather are separate", () => {
    expect(fx("lights off")).toEqual({ effect: "music_lights", on: false });
    expect(fx("Music lights on")).toEqual({ effect: "music_lights", on: true });
    expect(fx("turn off the music lights")).toEqual({ effect: "music_lights", on: false });
    expect(fx("weather effects off")).toEqual({ effect: "weather", on: false });
    expect(fx("weather effects on")).toEqual({ effect: "weather", on: true });
    expect(fx("stop the rain on screen")).toEqual({ effect: "weather", on: false });
  });
  it("Nova's lantern walk and voice", () => {
    expect(fx("Nova, lights off")).toEqual({ effect: "lantern_walk", on: true });
    expect(fx("nova lights on")).toEqual({ effect: "lantern_walk", on: false });
    expect(fx("stop the lantern walk")).toEqual({ effect: "lantern_walk", on: false });
    expect(fx("Nova be quiet")).toEqual({ effect: "pet_voice", on: false });
    expect(fx("Nova, you can talk again")).toEqual({ effect: "pet_voice", on: true });
  });
  it("colours", () => {
    expect(fx("make the music lights blue")).toEqual({ effect: "music_lights", on: true, color: "blue" });
    expect(fx("music lights rainbow")).toEqual({ effect: "music_lights", on: true, color: "rainbow" });
    expect(fx("pink music lights")).toEqual({ effect: "music_lights", on: true, color: "pink" });
  });
  it("leaves everything else to the AI", () => {
    expect(fx("why are the lights so bright in my office")).toBeNull();
    expect(fx("play a song")).toBeNull();
    expect(fx("Nova, how are you?")).toBeNull();
    expect(fx("turn off the lights in the kitchen at 9 pm and remind me to sleep early tonight please")).toBeNull();
  });
});

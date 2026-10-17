import { describe, expect, it } from "vitest";
import { quickEffect, quickGarden, quickGoodNight, quickPage } from "@/lib/agents/quick";

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

describe("garden festivals from chat (no AI)", () => {
  const fest = (m: string) => quickGarden(m)?.fest ?? null;
  it("opens the garden dressed for the festival or season", () => {
    expect(fest("show the garden for Deepavali")).toBe("deepavali");
    expect(fest("Show the garden for Diwali!")).toBe("deepavali");
    expect(fest("garden in karthigai deepam")).toBe("karthigai");
    expect(fest("pongal island")).toBe("pongal");
    expect(fest("show my garden in the monsoon")).toBe("monsoon");
    expect(fest("show the garden back to normal")).toBe("today");
  });
  it("leaves everything else alone", () => {
    expect(fest("show my Deepavali photos")).toBeNull();
    expect(fest("when is deepavali this year?")).toBeNull();
    expect(fest("open the garden")).toBeNull();
    expect(quickEffect("show the garden for Deepavali")).toBeNull();
  });
});

describe("open a page from chat (no AI)", () => {
  const go = (m: string) => quickPage(m)?.href ?? null;
  it("opens pages by name", () => {
    expect(go("Open nova garden")).toBe("/garden");
    expect(go("open my garden")).toBe("/garden");
    expect(go("take me to Nova's garden")).toBe("/garden");
    expect(go("go to settings")).toBe("/settings");
    expect(go("show my photos")).toBe("/photos");
    expect(go("hey hivemind, open notes please")).toBe("/notes");
    expect(go("let's play chess")).toBe("/games/chess");
    expect(go("open the memory palace")).toBe("/memories");
    expect(go("open kitchen mode")).toBe("/focus");
  });
  it("leaves searches, songs and longer requests to the agents", () => {
    expect(go("open my note about the Ooty trip")).toBeNull();
    expect(go("play Anirudh songs")).toBeNull();
    expect(go("play notes")).toBeNull();
    expect(go("show me the weather in Madurai")).toBeNull();
    expect(go("what's in my garden?")).toBeNull();
    expect(quickGarden("open nova garden")).toBeNull();
  });
});

describe("Nova's bedtime from chat (no AI)", () => {
  it("needs Nova's name", () => {
    expect(quickGoodNight("Nova, good night")).toBe(true);
    expect(quickGoodNight("good night nova!")).toBe(true);
    expect(quickGoodNight("goodnight Nova da")).toBe(true);
    expect(quickGoodNight("nova sleep time")).toBe(true);
    expect(quickGoodNight("good night")).toBe(false);
    expect(quickGoodNight("nova what's good at night in chennai")).toBe(false);
    expect(quickGoodNight("good night pixel", "pixel")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { intentCheck, isGuarded, unlocksAction } from "@/lib/agents/intent";

describe("intentCheck", () => {
  it("deletes need delete words from the owner", () => {
    expect(intentCheck("delete_memory", "what is my address")).toMatch(/needs the owner/);
    expect(intentCheck("delete_memory", "forget my old address")).toBeNull();
    expect(intentCheck("delete_note", "show my notes")).not.toBeNull();
    expect(intentCheck("delete_note", "delete the shopping note")).toBeNull();
  });

  it("Tamil delete word unlocks delete_memory", () => {
    expect(intentCheck("delete_memory", "அதை அழி")).toBeNull();
    expect(intentCheck("delete_project", "அந்த project நீக்கு")).toBeNull();
  });

  it("'yes' confirms a pending delete", () => {
    expect(intentCheck("confirm_delete_memory", "yes")).toBeNull();
    expect(intentCheck("confirm_delete_memory", "ஆமா")).toBeNull();
    expect(intentCheck("confirm_delete_memory", "what was it about")).not.toBeNull();
  });

  it("message_contact needs message words", () => {
    expect(intentCheck("message_contact", "whatsapp Arif that I'm late")).toBeNull();
    expect(intentCheck("message_contact", "what's Arif's number")).not.toBeNull();
  });

  it("create_routine needs 'routine' or 'when I say'", () => {
    expect(intentCheck("create_routine", "make a gym mode thing that plays songs")).not.toBeNull();
    expect(intentCheck("create_routine", "when I say gym mode, play workout songs")).toBeNull();
    expect(intentCheck("create_routine", "make a night routine")).toBeNull();
  });

  it("unguarded tools are always allowed", () => {
    expect(intentCheck("search_brain", "anything")).toBeNull();
  });
});

describe("isGuarded", () => {
  it("knows which tools are guarded", () => {
    expect(isGuarded("delete_memory")).toBe(true);
    expect(isGuarded("message_contact")).toBe(true);
    expect(isGuarded("search_brain")).toBe(false);
  });
});

describe("unlocksAction", () => {
  it("a harmless request unlocks nothing", () => {
    expect(unlocksAction("Check today's weather")).toBe(false);
  });
  it("a request that drops/cancels things does", () => {
    expect(unlocksAction("drop my gym habit and cancel the dentist reminder")).toBe(true);
  });
});

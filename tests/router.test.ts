import { describe, expect, it } from "vitest";
import { ruleBasedAgent } from "@/lib/agents/router";
import type { AgentId } from "@/lib/agents/types";

describe("ruleBasedAgent", () => {
  const cases: [string, AgentId | null, AgentId?][] = [
    ["remind me to call amma at 7", "scheduler"],
    ["play a tamil song", "core"],
    ["kitchen mode", "core"],
    ["what's my brief", "core"],
    ["make me an app to track petrol", "core"],
    ["delete the petrol app", "core"],
    ["hello", "core"],
    ["Thanks!", "core"],
    ["call Arif", "comms"],
    ["who called me", "comms"],
    ["Arif's number is 98765 43210", "comms"],
    ["where am i", "research"],
    ["what's the weather in Madurai", "research"],
    ["find react jobs in chennai", "career"],
    ["remember that my bike number is TN01", "memory"],
    ["I just finished my workout", "scheduler"],
    ["what is the meaning of life", null],
    // Messages that mention a file or don't start with "message".
    ["send the file to Arif on WhatsApp", "comms"],
    ["share my resume note via whatsapp", "comms"],
    ["tell amma I'm late", "comms"],
    ["Tell Arif the meeting moved to 5", "comms"],
    ["let Vijay know I'll be there by 6", "comms"],
    ["tell me about my projects", "project"],
    ["tell me a joke", null],
    ["tell the story of my career", null],
    ["open my shopping note", "memory"],
    // Follow-ups depend on who spoke last.
    ["yes", "memory", "memory"],
    ["yes", "project", "project"],
    ["yes", null],
    ["check #2", "career", "career"],
  ];

  it.each(cases)("%s → %s (previous: %s)", (message, expected, previous) => {
    expect(ruleBasedAgent(message, previous ?? null)).toBe(expected);
  });
});

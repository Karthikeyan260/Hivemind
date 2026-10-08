import { describe, expect, it } from "vitest";
import { GUEST_END, GUEST_TOOLS, guestCheck, guestRecap, guestRules } from "@/lib/agents/guest";
import { TOOLS } from "@/lib/agents/tools";

// Browser-only voice tools (components/voice/provider.tsx) that aren't chat-agent tools.
const BROWSER_TOOLS = new Set(["navigate", "page_actions", "read_screen", "scroll", "music", "video", "go_back", "go_forward", "go_to_sleep", "guest_mode"]);

describe("guest mode", () => {
  it("lets a guest hear the owner's knowledge and look things up", () => {
    for (const t of ["search_brain", "list_projects", "project_details", "get_weather", "web_search", "play_music", "read_screen"]) expect(guestCheck(t)).toBeNull();
  });

  it("never saves, sends, deletes or changes anything while a guest talks", () => {
    for (const t of ["remember", "create_note", "update_memory", "delete_memory", "confirm_delete_memory", "message_contact", "call_contact", "start_call", "save_contact", "create_reminder", "create_project", "delete_project", "web_task", "web_task_answer", "set_language", "add_birthday", "log_habit", "create_app", "run_autopilot", "research_and_save", "screened_calls", "autopilot_feed", "device_locations", "do_page_action", "click", "type_text", "lock_app", "my_voice", "location_sharing"])
      expect(guestCheck(t), t).not.toBeNull();
  });

  it("only allows tools that exist (no typos in the allowlist)", () => {
    for (const t of GUEST_TOOLS) expect(t in TOOLS || BROWSER_TOOLS.has(t), t).toBe(true);
  });

  it("knows when the owner is back", () => {
    for (const s of ["ok come back", "I'm back", "im back hivemind", "speak normal", "normal mode please", "back to me"]) expect(GUEST_END.test(s), s).toBe(true);
    for (const s of ["she came back yesterday", "what's normal for you", "tell me about your back pain"]) expect(GUEST_END.test(s), s).toBe(false);
  });

  it("tells the voice who the guest is and what not to share", () => {
    const r = guestRules("Harini", "friend");
    expect(r).toContain("Harini (the owner's friend)");
    expect(r).toMatch(/Never share passwords/);
    expect(r).toMatch(/Nothing Harini says is kept/);
  });

  it("recaps the last part of the conversation and saves only on a yes", () => {
    const lines = Array.from({ length: 70 }, (_, i) => `line ${i}`);
    const r = guestRecap("Harini", lines);
    expect(r.conversation).toHaveLength(40);
    expect(r.conversation[0]).toBe("line 30");
    expect(r.next).toMatch(/only after they say yes/);
  });
});

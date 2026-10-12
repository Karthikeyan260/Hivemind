import { describe, expect, it } from "vitest";
import { TOOLS } from "@/lib/agents/tools";

// Every tool name in the original single-file lib/agents/tools.ts (before the split into
// lib/agents/tools/*), in its original order. Nothing may go missing or be added by accident.
const ORIGINAL_TOOL_NAMES = [
  "search_brain", "remember", "update_memory", "delete_memory", "confirm_delete_memory", "open_source", "recent_memories",
  "web_search", "open_link", "find_product", "get_weather", "research_and_save",
  "analyze_job", "tailor_resume", "search_jobs", "check_listed_job", "delete_job_analysis", "job_analyses",
  "add_birthday", "upcoming_birthdays", "remove_birthday", "birthday_wish",
  "add_habit", "log_habit", "habits_status", "remove_habit", "snooze_habit",
  "create_note", "list_notes", "update_note", "delete_note", "list_documents", "delete_document", "update_project", "delete_project",
  "set_language",
  "save_contact", "call_contact", "message_contact", "start_call",
  "list_projects", "project_details", "create_project",
  "create_reminder", "list_reminders", "complete_reminder", "cancel_reminder", "reschedule_reminder",
  "get_profile", "refresh_profile",
  "where_am_i", "places_nearby", "directions", "device_locations",
  "create_app", "list_apps", "open_app", "change_app", "delete_app",
  "morning_brief", "brief_topics", "dream_report", "day_comic", "kitchen_mode",
  "create_routine", "list_routines", "run_routine", "delete_routine",
  "screened_calls", "call_screening",
  "play_music", "play_video",
  "web_task", "web_tasks_status", "web_task_answer", "web_task_delete",
  "autopilot_feed", "autopilot_update", "run_autopilot",
];

describe("TOOLS", () => {
  it("has exactly the original 79 tools", () => {
    expect(ORIGINAL_TOOL_NAMES).toHaveLength(79);
    expect(Object.keys(TOOLS).sort()).toEqual([...ORIGINAL_TOOL_NAMES].sort());
  });

  it("each tool's name matches its key and it is callable", () => {
    for (const [key, tool] of Object.entries(TOOLS)) {
      expect(tool.name).toBe(key);
      expect(typeof tool.run).toBe("function");
      expect(tool.description.length).toBeGreaterThan(10);
      expect((tool.parameters as { type?: string }).type).toBe("object");
    }
  });
});

import { NextResponse } from "next/server";
import { TOOLS as AGENT_TOOLS } from "@/lib/agents/tools";
import { geminiClient } from "@/lib/ai/gemini";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { listProjects } from "@/lib/organizer";
import { getPrefs, languageRule } from "@/lib/prefs";
import { getProfile, profileForPrompt } from "@/lib/profile";
import { agenda, agendaForPrompt, nowForPrompt } from "@/lib/reminders";

const MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.8-live";
const VOICE = process.env.GEMINI_TTS_VOICE || "Charon";

const PAGES = [
  { path: "/", what: "home bridge: galaxy and chat console" },
  { path: "/projects", what: "projects" },
  { path: "/memories", what: "memories" },
  {
    path: "/career",
    what: "career: job match analyses and tailored resume PDFs",
  },
  {
    path: "/journey",
    what: "journey: animated git-graph of education, internships, projects and current work",
  },
  { path: "/habits", what: "habits (today's checklist, streaks) and birthdays" },
  { path: "/notes", what: "notes" },
  { path: "/documents", what: "uploaded documents" },
  { path: "/sources", what: "data sources and imports" },
  { path: "/search", what: "search" },
  { path: "/settings", what: "settings" },
];

const VOICE_TOOLS = [
  {
    name: "search_brain",
    description:
      "Search the owner's personal knowledge base (memories, notes, documents, projects, resume, profile). Call this before answering anything about the owner, their work, projects, skills, history or saved knowledge.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for" },
      },
      required: ["query"],
    },
  },
  {
    name: "remember",
    description: "Save something the owner asks you to remember as a new memory. It is filed into the right project automatically.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The fact, idea or note to store, in full",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "create_project",
    description: "Create a new project when the owner asks to start one.",
    parametersJsonSchema: {
      type: "object",
      properties: { name: { type: "string" }, description: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "navigate",
    description: "Open a page of the HIVEMIND app for the owner (e.g. 'open career', 'go to my notes', 'show projects').",
    parametersJsonSchema: {
      type: "object",
      properties: {
        page: {
          type: "string",
          enum: PAGES.map((p) => p.path),
          description: PAGES.map((p) => `${p.path} = ${p.what}`).join("; "),
        },
      },
      required: ["page"],
    },
  },
  {
    name: "get_weather",
    description: "Live weather and 4-day forecast for a place (defaults to the owner's city, Chennai). Use for any weather, temperature, rain or forecast question.",
    parametersJsonSchema: {
      type: "object",
      properties: { place: { type: "string" } },
    },
  },
  {
    name: "web_search",
    description:
      "Search the internet (Google) for current or outside-world information: news, prices, releases, events, public facts. Set save=true when the owner asks to research/collect/gather information and keep it; it is then saved as a note with sources.",
    parametersJsonSchema: {
      type: "object",
      properties: { query: { type: "string" }, save: { type: "boolean" } },
      required: ["query"],
    },
  },
  {
    name: "create_reminder",
    description:
      'Schedule a reminder / meeting / deadline. \'date\' is "today", "tomorrow", a weekday ("friday", "next monday"), "in 3 days", or YYYY-MM-DD. \'time\' is local clock time like "15:00" or "3 pm" (omit for all-day). For "in 2 hours" use in_minutes instead. The server works out the exact moment; never compute UTC or years yourself.',
    parametersJsonSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        date: { type: "string" },
        time: { type: "string" },
        in_minutes: { type: "number" },
        details: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "change_reminder",
    description:
      'Cancel (removes it), complete, or reschedule a reminder/meeting. \'which\' = words from its title and/or \'today\'/\'tomorrow\'. For reschedule give the new date and/or time (time alone keeps the same day). \'date\' is "today", "tomorrow", a weekday ("friday", "next monday"), "in 3 days", or YYYY-MM-DD. \'time\' is local clock time like "15:00" or "3 pm" (omit for all-day). For "in 2 hours" use in_minutes instead. The server works out the exact moment; never compute UTC or years yourself. Never use complete for a cancellation.',
    parametersJsonSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["cancel", "complete", "reschedule"] },
        which: { type: "string" },
        date: { type: "string" },
        time: { type: "string" },
        in_minutes: { type: "number" },
      },
      required: ["action", "which"],
    },
  },
  {
    name: "list_reminders",
    description: "The owner's agenda (overdue, today, tomorrow, later). Use for 'what do I have today/tomorrow'.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "analyze_job",
    description:
      "Run a real job-match analysis (fit score, ATS keyword match, gaps, cover letter). Use when the owner says 'analyse this job'. On the Career page, ALWAYS call it with no arguments first: the tool reads the pasted job description box itself (you cannot see it). Only pass job_description if the owner read a full job description out loud. Don't ask them to paste unless this tool says the box is empty.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        job_description: { type: "string" },
        role: { type: "string" },
        company: { type: "string" },
      },
    },
  },
  {
    name: "tailor_resume",
    description:
      "Generate the tailored resume PDF for the job analysis currently open on the Career page (or the latest one). Use for 'generate / make my resume for this job'. Takes about 20 seconds.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "create_note",
    description: "Create a note (longer text the owner dictates or asks to write down as a note).",
    parametersJsonSchema: {
      type: "object",
      properties: { title: { type: "string" }, content: { type: "string" } },
      required: ["content"],
    },
  },
  {
    name: "page_actions",
    description: "List the buttons/actions available on the page the owner is looking at (e.g. download PDF, regenerate, delete).",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "do_page_action",
    description: "Perform one of the current page's actions by name (from page_actions). 'input' is optional text for it.",
    parametersJsonSchema: {
      type: "object",
      properties: { name: { type: "string" }, input: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "read_screen",
    description:
      "Read what is on the owner's screen right now (current page, its visible text, and the buttons, fields and dropdowns on it). Call it whenever they say 'this', 'here', 'this page/job/note', or ask about what they are looking at.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "click",
    description:
      "Click a button, link, tab or checkbox on the current page by its visible label (e.g. 'Download PDF', 'Regenerate', 'Notes', 'View PDF'). Buttons that delete/replace something return needs_confirmation: ask the owner, then call again with confirmed=true.",
    parametersJsonSchema: { type: "object", properties: { target: { type: "string" }, confirmed: { type: "boolean" } }, required: ["target"] },
  },
  {
    name: "scroll",
    description: "Scroll the current page. direction: down / up / top / bottom (amount = screens, default 1). Or 'to' = text of a section/heading/item to bring into view.",
    parametersJsonSchema: { type: "object", properties: { direction: { type: "string" }, amount: { type: "number" }, to: { type: "string" } } },
  },
  {
    name: "type_text",
    description: "Type into a field on the current page (field = its label or placeholder, e.g. 'Search your memories', 'Role', 'Company'). submit=true presses Enter / submits the form.",
    parametersJsonSchema: { type: "object", properties: { field: { type: "string" }, text: { type: "string" }, submit: { type: "boolean" } }, required: ["text"] },
  },
  {
    name: "select_option",
    description: "Choose an option in a dropdown on the current page (e.g. field 'types' option 'Fact', or option 'Sort: oldest').",
    parametersJsonSchema: { type: "object", properties: { field: { type: "string" }, option: { type: "string" } }, required: ["option"] },
  },
  { name: "go_back", description: "Browser back: return to the previous page.", parametersJsonSchema: { type: "object", properties: {} } },
  { name: "go_forward", description: "Browser forward.", parametersJsonSchema: { type: "object", properties: {} } },
  {
    name: "go_to_sleep",
    description: "End the live voice conversation and turn the microphone off ('go to sleep', 'stop listening', 'that's all', 'bye').",
    parametersJsonSchema: { type: "object", properties: {} },
  },
];

// Voice gets every chat-agent tool too (run on the server via /api/agent-tool), except the ones the
// voice tools above already cover in a voice-friendly way (change_reminder handles all three).
const COVERED = new Set([...VOICE_TOOLS.map((t) => t.name), "cancel_reminder", "reschedule_reminder", "complete_reminder"]);
const TOOLS = [
  {
    functionDeclarations: [
      ...VOICE_TOOLS,
      ...Object.values(AGENT_TOOLS)
        .filter((t) => !COVERED.has(t.name))
        .map((t) => ({
          name: t.name,
          description: t.description,
          parametersJsonSchema: t.parameters,
        })),
    ],
  },
];

/**
 * Mints a single-use, short-lived token so the browser can open a real-time voice session with
 * Gemini Live directly, without ever seeing the real API key. Also returns the session config
 * (persona grounded in the owner's profile, voice, and the brain tools).
 */
export const POST = handle(async () => {
  const supabase = db();
  const [profile, projects, schedule, prefs] = await Promise.all([
    getProfile(supabase),
    listProjects(supabase),
    agenda(supabase, 2)
      .then(agendaForPrompt)
      .catch(() => "(unavailable)"),
    getPrefs(supabase).catch(() => ({ language: "auto" as const })),
  ]);

  const systemInstruction = `You are HIVEMIND, the owner's personal AI, speaking out loud in a live voice conversation.
Voice rules: sound natural and warm, like a trusted aide. Keep replies short (1-3 sentences) unless asked for detail.
Never read URLs, IDs, markdown or citation numbers aloud. Say numbers naturally.

What you understand about the owner:
${profileForPrompt(profile)}

Their projects: ${projects.map((p) => p.name).join(", ") || "(none yet)"}

Current local time: ${nowForPrompt()}
Their schedule:
${schedule}

Tools:
- Call search_brain before answering anything about the owner, their work, projects or saved knowledge. Answer only from what it returns; if it has nothing, say so briefly.
- Call remember when they ask you to remember or note something. Confirm in a few words.
- Call create_project when they ask to start a project.
- The owner can talk to you from any page of the app. Call navigate when they ask to open or go to a page, then say where you took them in a few words.
- You can operate the app: analyze_job, tailor_resume, create_note, navigate, and any page button via page_actions + do_page_action. When the owner asks for something the app can do, DO it with a tool instead of describing it. If you aren't sure an action exists, call page_actions.
- For reminders, meetings and deadlines call create_reminder (confirm the day and time in plain words); for 'what's on today/tomorrow' call list_reminders; to cancel, finish or move one call change_reminder.
- For weather call get_weather; for news or anything happening in the world call web_search. Never guess live facts from memory. Mention where it came from briefly ("according to ..."), no URLs.
- For "analyse this / this job", call analyze_job directly; don't use read_screen to check for the job description first.
- Before a slow tool (analyze_job, tailor_resume), say one short line like "On it, give me a few seconds."
- NEVER claim something was done, generated, saved or opened unless a tool just returned success for it. If a tool returns an error, say what went wrong in plain words.
- Memories: update_memory to correct one. To delete ('forget…', 'delete the memory about…'): call delete_memory, say the memory's title and ask "Delete it?"; call confirm_delete_memory ONLY after they answer yes in their next turn. Mention it can be undone from the activity log.
- Job analyses (Career history): to delete one call delete_job_analysis ("this one" on the Career page = the analysis on screen), say which and ask "Delete it?"; call confirm_delete_memory only after they say yes in their next turn.
- "Where did that come from / take me there / open the source": call open_source (empty 'about' = what you just said). It opens the page; say in one line where the info came from.
- Jobs: search_jobs finds live openings (role and/or location; empty role = based on their resume). Read out the top 3-5 as "number, role at company, city" and ask which one to check. When they pick one ("number two", "the Infosys one"), say "On it, about half a minute" and call check_listed_job with their pick: it runs the ATS check, generates the tailored resume and opens it in Career. Report fit, ATS percent and the main missing keywords.
- Also available: recent_memories, list_projects, project_details, job_analyses, get_profile, refresh_profile, research_and_save.
- When the owner says "go to sleep", "stop listening", "that's all for now" or says goodbye, call go_to_sleep, then say a very short goodbye (a few words). The mic turns off after that.
- Contacts: "call Arif" → call_contact; "WhatsApp/text Vijay that …" → message_contact; "Arif's number is …" → save_contact; a call through the site / internet call → start_call (it opens the call screen). A green button appears on screen: say "Tap the green Call button" (you can't dial or send yourself). If several numbers match, read them out and ask which.
- You can use every page like a person would: scroll (up/down/top/bottom or to a section), click any button/link/tab by its label, type_text into fields, select_option in dropdowns, go_back. If you don't know the exact label, call read_screen first (it lists the controls). Do it instead of telling the owner to do it.
- On the home page the 3D galaxy has its own actions (via page_actions / do_page_action): rotate_galaxy ('left', 'right 90', 'up'), zoom_galaxy ('in' / 'out'), focus_project (project name), reset_galaxy_view, galaxy_auto_rotate ('on'/'off'). "Zoom into project X" = focus_project.
- Call read_screen when they refer to what they're looking at ("this job", "summarise this page", "what's my fit here"), then answer from it.
For general questions unrelated to the owner, just answer.

${languageRule(prefs.language)}
In voice, speak Tamil naturally like a Chennai friend would (not formal written Tamil).`;

  const now = Date.now();
  const token = await geminiClient().authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(now + 30 * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + 60_000).toISOString(),
      httpOptions: { apiVersion: "v1alpha" },
    },
  });

  return NextResponse.json({
    token: token.name,
    model: MODEL,
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      systemInstruction,
      tools: TOOLS,
    },
  });
});

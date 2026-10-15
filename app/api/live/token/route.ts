import { NextResponse } from "next/server";
import { z } from "zod";
import { TOOLS as AGENT_TOOLS } from "@/lib/agents/tools";
import { geminiClient } from "@/lib/ai/gemini";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { listProjects } from "@/lib/organizer";
import { petName } from "@/lib/pet";
import { activeVoiceId } from "@/lib/my-voice";
import { getPrefs, languageRule } from "@/lib/prefs";
import { getProfile, profileForPrompt } from "@/lib/profile";
import { agenda, agendaForPrompt, nowForPrompt } from "@/lib/reminders";
import { listRoutines, routinesForPrompt } from "@/lib/routines";
import { planFor } from "@/lib/voice/plan";

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
  { path: "/autopilot", what: "Autopilot: what HIVEMIND noticed on its own, run it now, its schedule" },
  { path: "/web", what: "Web tasks: HIVEMIND driving a cloud browser, approvals, live view" },
  { path: "/map", what: "Map: where you are, your devices, places nearby, routes" },
  { path: "/apps", what: "Apps HIVEMIND built for the owner (create, change, delete)" },
  { path: "/routines", what: "Routines: one phrase that does several things (good morning, gym mode)" },
  { path: "/share", what: "Share: save a link, text, photo or file into the brain (also from Android's Share menu)" },
  { path: "/comic", what: "Your day as a comic: four panels with the owner's mascot; earlier days too" },
  { path: "/games", what: "Games: Paattu Quiz (guess the Tamil song's film) and Draw & Guess (2 players + HIVEMIND)" },
  { path: "/brief", what: "Morning brief: news on the topics the owner follows, every morning" },
  { path: "/dream", what: "Dream mode: what HIVEMIND tidied in the memories overnight, with undo" },
  { path: "/focus", what: "Kitchen / hands-free mode: full screen, big voice orb, screen stays on" },
  { path: "/calls", what: "Calls: call screening settings, the owner's call link, calls HIVEMIND answered" },
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
    name: "music",
    description:
      "HIVEMIND's own music player (full songs, no ads, plays right here on the owner's device; Tamil and every Indian language). play = search and start (a song title, artist, film, or mood like 'Tamil melody', 'Anirudh hits'); add = play that song next; pause; resume; next; previous; stop; volume_up / volume_down / set_volume (0-100); now_playing; queue (list it); jump (play queue number 'position').",
    parametersJsonSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["play", "add", "pause", "resume", "next", "previous", "stop", "volume_up", "volume_down", "set_volume", "now_playing", "queue", "jump"] },
        query: { type: "string", description: "What to play (play / add)" },
        volume: { type: "number", description: "0-100 for set_volume" },
        position: { type: "number", description: "Queue number for jump" },
      },
      required: ["action"],
    },
  },
  {
    name: "video",
    description:
      "HIVEMIND's video player (YouTube's player in a window on the owner's screen, free). play = search and start (a video, trailer, song video, how-to); add = play next; pause; resume; next; previous; stop (close it); fullscreen; expand (big window in the middle); minimize (small floating picture-in-picture window the owner can drag anywhere); hide (keep playing, only a thin bar); show (bring the small window back); volume_up / volume_down; now_playing; queue; jump (queue number 'position').",
    parametersJsonSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["play", "add", "pause", "resume", "next", "previous", "stop", "fullscreen", "expand", "minimize", "hide", "show", "volume_up", "volume_down", "now_playing", "queue", "jump"] },
        query: { type: "string", description: "What to watch (play / add)" },
        position: { type: "number", description: "Queue number for jump" },
      },
      required: ["action"],
    },
  },
  {
    name: "my_voice",
    description: "Speak in the owner's own cloned voice (on) or HIVEMIND's usual voice (off). Takes effect from the next reply. Needs the voice set up in Settings → My voice.",
    parametersJsonSchema: { type: "object", properties: { on: { type: "boolean" } }, required: ["on"] },
  },
  {
    name: "location_sharing",
    description: "Share THIS device's location with HIVEMIND (on/off), so 'where's my phone' works from the owner's other devices. On asks the browser for permission.",
    parametersJsonSchema: { type: "object", properties: { on: { type: "boolean" } }, required: ["on"] },
  },
  {
    name: "lock_app",
    description: "Lock HIVEMIND now (password needed to open it again) and end the voice session. Only when the owner asks to lock it.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "guest_mode",
    description:
      "Start guest mode when the owner introduces someone to talk with ('this is Harini, my friend', 'she is Harini, talk to her', 'meet my colleague Arun'): you then talk with that person the way the owner would, and nothing they say is saved. End it when the owner says 'come back', 'I'm back', 'speak normal' or 'normal mode'.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["start", "end"] },
        name: { type: "string", description: "The guest's name (start)." },
        relation: { type: "string", description: "Who they are to the owner: friend, sister, colleague… (start, optional)." },
      },
      required: ["action"],
    },
  },
  {
    name: "go_to_sleep",
    description: "End the live voice conversation and turn the microphone off ('go to sleep', 'stop listening', 'that's all', 'bye').",
    parametersJsonSchema: { type: "object", properties: {} },
  },
];

// Voice can use every chat-agent tool too (run on the server via /api/agent-tool), except the ones
// the voice tools above already cover in a voice-friendly way (change_reminder handles all three).
const COVERED = new Set([...VOICE_TOOLS.map((t) => t.name), "play_music", "play_video", "cancel_reminder", "reschedule_reminder", "complete_reminder"]);
const AGENT_VOICE_TOOLS = Object.values(AGENT_TOOLS).filter((t) => !COVERED.has(t.name));
const declare = (t: (typeof AGENT_VOICE_TOOLS)[number]) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters });

/** The two doors to everything not loaded this session (see lib/voice/plan.ts). */
const metaTools = (more: string[]) => [
  {
    name: "use_tool",
    description: "Run one of the tools listed under 'More you can do' (not loaded this session) by its name, with its arguments.",
    parametersJsonSchema: {
      type: "object",
      properties: { name: { type: "string", enum: more }, args: { type: "object", description: "The tool's arguments (see tool_help)." } },
      required: ["name"],
    },
  },
  {
    name: "tool_help",
    description: "What a not-loaded tool does, its arguments and how to use it. Call before use_tool if unsure.",
    parametersJsonSchema: { type: "object", properties: { name: { type: "string", enum: more } }, required: ["name"] },
  },
];

const Body = z.object({ path: z.string().max(200).default("/") }).default({ path: "/" });

/**
 * Mints a single-use, short-lived token so the browser can open a real-time voice session with
 * Gemini Live directly, without ever seeing the real API key. Also returns the session config:
 * persona grounded in the owner's profile, voice, the core tools plus the ones for the page the
 * owner is on, and (for the browser) how to use the rest.
 */
export const POST = handle(async (req: Request) => {
  const { path } = Body.parse(await req.json().catch(() => ({})));
  const supabase = db();
  const [profile, projects, schedule, prefs, routines, pet] = await Promise.all([
    getProfile(supabase),
    listProjects(supabase),
    agenda(supabase, 2)
      .then(agendaForPrompt)
      .catch(() => "(unavailable)"),
    getPrefs(supabase).catch(() => ({ language: "auto" as const })),
    listRoutines(supabase).catch(() => []),
    petName(supabase).catch(() => "Nova"),
  ]);

  const plan = planFor(
    path,
    AGENT_VOICE_TOOLS.map((t) => t.name),
    { routines: routinesForPrompt(routines) },
  );
  const tools = [
    {
      functionDeclarations: [...VOICE_TOOLS, ...AGENT_VOICE_TOOLS.filter((t) => plan.loaded.has(t.name)).map(declare), ...(plan.more.length ? metaTools(plan.more) : [])],
    },
  ];
  // For tool_help, answered in the browser without another round trip.
  const catalog = Object.fromEntries(
    AGENT_VOICE_TOOLS.filter((t) => plan.more.includes(t.name)).map((t) => [t.name, { description: t.description, parameters: t.parameters, how: plan.howTo[t.name] ?? "" }]),
  );

  const systemInstruction = `You are HIVEMIND, the owner's personal AI, speaking out loud in a live voice conversation.
Voice rules: sound natural and warm, like a trusted aide. Keep replies short (1-3 sentences) unless asked for detail.
Never read URLs, IDs, markdown or citation numbers aloud. Say numbers naturally.

What you understand about the owner:
${profileForPrompt(profile)}

Their projects: ${projects.map((p) => p.name).join(", ") || "(none yet)"}

Current local time: ${nowForPrompt()}
The owner is on the page ${path}.
Their schedule:
${schedule}

Tools:
${plan.instructions}
For general questions unrelated to the owner, just answer.

The owner's pocket pet (the little glowing lantern on screen) is called "${pet}". Saying just "${pet}", "${pet}?" or "hey ${pet}" means they're calling the pet: do_page_action nova_status (it opens its card) and answer in a playful line. Speech-to-text often garbles this short name (e.g. ${pet === "Nova" ? '"Noa", "No va", "Nava", "Nové"' : "a similar-sounding word"}): a lone short word that sounds like it means the pet, not a greeting.

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
    // "Speak in my voice": Live's own voice is muted and its transcript is spoken in the owner's clone.
    myVoice: !!(await activeVoiceId()),
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      systemInstruction,
      tools,
    },
    catalog,
  });
});

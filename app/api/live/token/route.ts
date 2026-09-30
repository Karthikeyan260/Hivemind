import { NextResponse } from "next/server";
import { geminiClient } from "@/lib/ai/gemini";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { listProjects } from "@/lib/organizer";
import { getProfile, profileForPrompt } from "@/lib/profile";

const MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.8-live";
const VOICE = process.env.GEMINI_TTS_VOICE || "Charon";

const PAGES = [
  { path: "/", what: "home bridge: galaxy and chat console" },
  { path: "/projects", what: "projects" },
  { path: "/memories", what: "memories" },
  { path: "/career", what: "career: job match analyses and tailored resume PDFs" },
  { path: "/notes", what: "notes" },
  { path: "/documents", what: "uploaded documents" },
  { path: "/sources", what: "data sources and imports" },
  { path: "/search", what: "search" },
  { path: "/settings", what: "settings" },
];

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "search_brain",
        description:
          "Search the owner's personal knowledge base (memories, notes, documents, projects, resume, profile). Call this before answering anything about the owner, their work, projects, skills, history or saved knowledge.",
        parametersJsonSchema: { type: "object", properties: { query: { type: "string", description: "What to look for" } }, required: ["query"] },
      },
      {
        name: "remember",
        description: "Save something the owner asks you to remember as a new memory. It is filed into the right project automatically.",
        parametersJsonSchema: { type: "object", properties: { content: { type: "string", description: "The fact, idea or note to store, in full" } }, required: ["content"] },
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
          properties: { page: { type: "string", enum: PAGES.map((p) => p.path), description: PAGES.map((p) => `${p.path} = ${p.what}`).join("; ") } },
          required: ["page"],
        },
      },
      {
        name: "get_weather",
        description: "Live weather and 4-day forecast for a place (defaults to the owner's city, Chennai). Use for any weather, temperature, rain or forecast question.",
        parametersJsonSchema: { type: "object", properties: { place: { type: "string" } } },
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
        name: "analyze_job",
        description:
          "Run a real job-match analysis (fit score, ATS keyword match, gaps, cover letter). Use when the owner says 'analyse this job'. On the Career page, ALWAYS call it with no arguments first: the tool reads the pasted job description box itself (you cannot see it). Only pass job_description if the owner read a full job description out loud. Don't ask them to paste unless this tool says the box is empty.",
        parametersJsonSchema: {
          type: "object",
          properties: { job_description: { type: "string" }, role: { type: "string" }, company: { type: "string" } },
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
        parametersJsonSchema: { type: "object", properties: { title: { type: "string" }, content: { type: "string" } }, required: ["content"] },
      },
      {
        name: "page_actions",
        description: "List the buttons/actions available on the page the owner is looking at (e.g. download PDF, regenerate, delete).",
        parametersJsonSchema: { type: "object", properties: {} },
      },
      {
        name: "do_page_action",
        description: "Perform one of the current page's actions by name (from page_actions). 'input' is optional text for it.",
        parametersJsonSchema: { type: "object", properties: { name: { type: "string" }, input: { type: "string" } }, required: ["name"] },
      },
      {
        name: "read_screen",
        description:
          "Read what is on the owner's screen right now (current page and its visible text). Call it whenever they say 'this', 'here', 'this page/job/note', or ask about what they are looking at.",
        parametersJsonSchema: { type: "object", properties: {} },
      },
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
  const [profile, projects] = await Promise.all([getProfile(supabase), listProjects(supabase)]);

  const systemInstruction = `You are HIVEMIND, the owner's personal AI, speaking out loud in a live voice conversation.
Voice rules: sound natural and warm, like a trusted aide. Keep replies short (1-3 sentences) unless asked for detail.
Never read URLs, IDs, markdown or citation numbers aloud. Say numbers naturally.

What you understand about the owner:
${profileForPrompt(profile)}

Their projects: ${projects.map((p) => p.name).join(", ") || "(none yet)"}

Tools:
- Call search_brain before answering anything about the owner, their work, projects or saved knowledge. Answer only from what it returns; if it has nothing, say so briefly.
- Call remember when they ask you to remember or note something. Confirm in a few words.
- Call create_project when they ask to start a project.
- The owner can talk to you from any page of the app. Call navigate when they ask to open or go to a page, then say where you took them in a few words.
- You can operate the app: analyze_job, tailor_resume, create_note, navigate, and any page button via page_actions + do_page_action. When the owner asks for something the app can do, DO it with a tool instead of describing it. If you aren't sure an action exists, call page_actions.
- For weather call get_weather; for news or anything happening in the world call web_search. Never guess live facts from memory. Mention where it came from briefly ("according to ..."), no URLs.
- For "analyse this / this job", call analyze_job directly; don't use read_screen to check for the job description first.
- Before a slow tool (analyze_job, tailor_resume), say one short line like "On it, give me a few seconds."
- NEVER claim something was done, generated, saved or opened unless a tool just returned success for it. If a tool returns an error, say what went wrong in plain words.
- Call read_screen when they refer to what they're looking at ("this job", "summarise this page", "what's my fit here"), then answer from it.
For general questions unrelated to the owner, just answer.`;

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
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      systemInstruction,
      tools: TOOLS,
    },
  });
});

import { NextResponse } from "next/server";
import { geminiClient } from "@/lib/ai/gemini";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { listProjects } from "@/lib/organizer";
import { getProfile, profileForPrompt } from "@/lib/profile";

const MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.8-live";
const VOICE = process.env.GEMINI_TTS_VOICE || "Charon";

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

import { NextResponse } from "next/server";
import { z } from "zod";
import { dbError, handle, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { scrub } from "@/lib/scrub";

const Body = z.object({
  conversation_id: z.uuid().nullable().optional(),
  user: z.string().trim().max(8000),
  assistant: z.string().trim().max(20000),
  sources: z.array(z.object({ n: z.number(), type: z.string(), title: z.string(), href: z.string(), similarity: z.number() })).max(20).optional(),
});

/** Saves one live voice exchange (both transcripts) to the chat history. */
export const POST = handle(async (req: Request) => {
  const { conversation_id, user: rawUser, assistant: rawAssistant, sources } = await parseBody(req, Body);
  // Transcripts come from speech recognition: no NUL character or broken emoji half may reach the database.
  const user = scrub(rawUser);
  const assistant = scrub(rawAssistant);
  if (!user && !assistant) return NextResponse.json({ conversation_id: conversation_id ?? null });
  const supabase = db();
  let conversationId = conversation_id ?? null;
  if (!conversationId) {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ title: scrub(`🎙 ${(user || assistant).slice(0, 76)}`) })
      .select("id")
      .single();
    dbError(error);
    conversationId = data!.id as string;
  }
  const rows = [
    ...(user ? [{ conversation_id: conversationId, role: "user", content: user, metadata: { via: "live" } }] : []),
    ...(assistant
      ? [{ conversation_id: conversationId, role: "assistant", content: assistant, metadata: { via: "live", model: "gemini-live", sources: sources ?? [] } }]
      : []),
  ];
  if (rows.length) {
    const { error } = await supabase.from("messages").insert(rows);
    dbError(error);
  }
  return NextResponse.json({ conversation_id: conversationId });
});

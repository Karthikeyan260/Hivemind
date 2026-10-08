import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { cancelMigration, embeddingStatus, migrationStep, startMigration } from "@/lib/embedding-migration";

export const maxDuration = 60;

/** Settings → Embeddings: which model made the vectors, and re-embedding everything. */
export const GET = handle(async () => NextResponse.json(await embeddingStatus(db())));

const Body = z.object({ action: z.enum(["start", "step", "cancel"]), model: z.string().max(80).optional() });

export const POST = handle(async (req: Request) => {
  const { action, model } = await parseBody(req, Body);
  const supabase = db();
  if (action === "start") {
    try {
      await startMigration(supabase, model || undefined);
    } catch (e) {
      throw new HttpError(400, `Couldn't start: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
    }
    await migrationStep(supabase, 35_000);
  } else if (action === "step") await migrationStep(supabase, 45_000);
  else await cancelMigration(supabase);
  return NextResponse.json(await embeddingStatus(supabase));
});

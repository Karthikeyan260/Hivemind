import { after, NextResponse } from "next/server";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { generate, listApps, startApp } from "@/lib/apps";
import { db } from "@/lib/db";

// A build runs after the response and usually takes 20-30 s.
export const maxDuration = 60;

/** The owner's apps. */
export const GET = handle(async () => NextResponse.json({ apps: await listApps(db()) }));

const Body = z.object({ request: z.string().trim().min(5).max(1500) });

/** "Make me an app to…": saved as building at once, written in the background. */
export const POST = handle(async (req: Request) => {
  const { request } = await parseBody(req, Body);
  const app = await startApp(db(), request);
  after(() => generate(db(), app.id, request));
  return NextResponse.json({ id: app.id, status: app.status }, { status: 202 });
});

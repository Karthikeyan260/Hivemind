import { NextResponse } from "next/server";

/** The build the server is running (the app reloads itself when it's newer than its own). */
export const GET = () => NextResponse.json({ build: process.env.NEXT_PUBLIC_BUILD ?? "" }, { headers: { "Cache-Control": "no-store" } });

import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { getRoomCode, rotateRoomCode } from "@/lib/theatre/room";

/** The owner's permanent theatre room code (private: the password gate covers /api/theatre). */
const NO_STORE = { headers: { "Cache-Control": "no-store" } }; // the code must never sit in a cache

export const GET = handle(async () => NextResponse.json({ code: await getRoomCode(db()) }, NO_STORE));

/** A new code: use it when the old link has leaked. */
export const POST = handle(async () => NextResponse.json({ code: await rotateRoomCode(db()) }, NO_STORE));

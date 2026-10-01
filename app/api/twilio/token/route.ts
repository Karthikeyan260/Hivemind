import { NextResponse } from "next/server";
import { handle, HttpError } from "@/lib/api";
import { callerId, twilioConfigured, voiceToken } from "@/lib/twilio";

/** Owner-only (behind the password gate): a token so this browser can place a real phone call. */
export const GET = handle(async () => {
  if (!twilioConfigured()) throw new HttpError(503, "Calling through HIVEMIND isn't set up: add the TWILIO_* keys to the environment.");
  const id = callerId();
  return NextResponse.json({ token: voiceToken(), callerId: `${id.slice(0, 3)}…${id.slice(-3)}` });
});

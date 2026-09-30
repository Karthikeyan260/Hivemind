import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { dueAlerts } from "@/lib/reminders";

/** Polled by open HIVEMIND tabs: reminders whose alert time has come (each is returned once). */
export const GET = handle(async () => NextResponse.json(await dueAlerts(db())));

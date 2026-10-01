import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { notify } from "@/lib/push";

export const POST = handle(async () =>
  NextResponse.json({ sent: await notify(db(), { title: "HIVEMIND", body: "Notifications are working. You'll hear from me here.", url: "/settings", tag: "test" }) }),
);

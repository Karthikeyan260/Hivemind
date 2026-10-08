import "server-only";
import { HttpError } from "@/lib/api";
import { brain } from "./tools/brain";
import { web } from "./tools/web";
import { career } from "./tools/career";
import { schedule } from "./tools/schedule";
import { profile } from "./tools/profile";
import { contacts } from "./tools/contacts";
import { places } from "./tools/places";
import { apps } from "./tools/apps";
import { routines } from "./tools/routines";
import { media } from "./tools/media";
import { autopilot } from "./tools/autopilot";
import type { Tool } from "./types";

/** Every tool the agents and live voice can call, grouped by domain in ./tools/. */
export const TOOLS: Record<string, Tool> = { ...brain, ...web, ...career, ...schedule, ...profile, ...contacts, ...places, ...apps, ...routines, ...media, ...autopilot };

export function toolOrThrow(name: string) {
  const t = TOOLS[name];
  if (!t) throw new HttpError(500, `Unknown tool ${name}`);
  return t;
}

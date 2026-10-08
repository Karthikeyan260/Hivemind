import "server-only";
import { type Language, setPrefs } from "@/lib/prefs";
import { getProfile, rebuildProfile } from "@/lib/profile";
import { obj, str } from "./shared";
import type { Tool } from "../types";

/** The owner's profile and reply language. */
export const profile: Record<string, Tool> = {
  set_language: {
    name: "set_language",
    description: "Change the language HIVEMIND replies in: 'en' (English), 'ta' (Tamil), or 'auto' (match the owner).",
    parameters: obj({ language: { type: "string", enum: ["auto", "en", "ta"] } }, ["language"]),
    async run(args, ctx) {
      const language = (["auto", "en", "ta"].includes(str(args.language)) ? str(args.language) : "auto") as Language;
      await setPrefs(ctx.supabase, { language });
      return { language, note: "Takes effect from the next reply (voice: the next session)." };
    },
  },

  /* ───── profile ───── */
  get_profile: {
    name: "get_profile",
    description: "HIVEMIND's current understanding of the owner: role, location, summary, skills, focus areas, goals.",
    parameters: obj({}),
    async run(_args, ctx) {
      return (await getProfile(ctx.supabase)) ?? { note: "No profile yet." };
    },
  },
  refresh_profile: {
    name: "refresh_profile",
    description: "Re-read the whole brain and rebuild the owner's profile (use when they say their info changed or ask to refresh).",
    parameters: obj({}),
    async run(_args, ctx) {
      await rebuildProfile(ctx.supabase);
      ctx.changed = true;
      return { refreshed: true, profile: await getProfile(ctx.supabase) };
    },
  },
};

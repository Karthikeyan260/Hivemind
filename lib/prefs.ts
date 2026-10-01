import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readJSON, writeJSON } from "@/lib/private-store";

/** Owner preferences that shape how HIVEMIND talks. */
export type Language = "auto" | "en" | "ta";
export type Prefs = { language: Language };

const KEY = "prefs";
const DEFAULTS: Prefs = { language: "auto" };

export const getPrefs = async (supabase: SupabaseClient): Promise<Prefs> => ({ ...DEFAULTS, ...(await readJSON<Partial<Prefs>>(supabase, KEY, {})) });
export async function setPrefs(supabase: SupabaseClient, patch: Partial<Prefs>) {
  const next = { ...(await getPrefs(supabase)), ...patch };
  await writeJSON(supabase, KEY, next);
  return next;
}

/** The language rule added to chat and voice instructions. */
export function languageRule(lang: Language) {
  if (lang === "ta")
    return "Language: always reply in Tamil (Tamil script), natural spoken Chennai Tamil, warm and casual. Keep names of tools, apps, code and technical terms in English. If the owner asks for English, switch to English.";
  if (lang === "en") return "Language: always reply in English. The owner may speak Tamil or Tanglish: understand it, but answer in English.";
  return [
    "Language: reply in the language the owner is using, and switch whenever they switch.",
    "- Tamil (Tamil script or spoken Tamil) → reply in natural spoken Tamil, in Tamil script.",
    '- Tanglish (Tamil written in English letters, or Tamil-English mix, e.g. "enna plan today", "naalaiku meeting irukka") → reply in the same friendly Tanglish, in English letters.',
    "- English → English.",
    "Keep names of tools, apps, code and technical terms in English in every language.",
  ].join("\n");
}

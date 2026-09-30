import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CAREER_SOURCE } from "@/lib/career";

const PORTFOLIO_REPO =
  process.env.PORTFOLIO_DATA_REPO || "Karthikeyan260/Portfolio-mcp";

/** Where a brain item originally came from outside HIVEMIND (imported web page, portfolio repo, job posting…). */
export async function originOf(
  supabase: SupabaseClient,
  type: string,
  id: string,
): Promise<string | null> {
  if (!id) return null;
  if (type === "document") {
    const { data } = await supabase
      .from("documents")
      .select("source_url")
      .eq("id", id)
      .maybeSingle();
    return (data?.source_url as string | null) ?? null;
  }
  if (type === "memory") {
    const { data } = await supabase
      .from("memories")
      .select("metadata")
      .eq("id", id)
      .maybeSingle();
    const md = (data?.metadata ?? {}) as {
      source?: string;
      apply_link?: string | null;
    };
    if (md.source === CAREER_SOURCE) return md.apply_link ?? null;
    if (md.source === "portfolio-mcp")
      return `https://github.com/${PORTFOLIO_REPO}`;
  }
  return null;
}

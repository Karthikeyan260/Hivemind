import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { embeddingStatus } from "@/lib/embedding-migration";

export type Check = { name: string; status: "ok" | "warn" | "fail"; detail: string };

/** Tables in the public schema with row level security off (open to the public key). */
export async function openTables(supabase: SupabaseClient): Promise<string[] | null> {
  const { data, error } = await supabase.rpc("tables_without_rls");
  if (error) return null; // migration 004 not run yet
  return ((data ?? []) as { table_name: string }[]).map((r) => r.table_name);
}

/** Settings → System check: things that silently break a second brain if they drift. */
export async function systemCheck(supabase: SupabaseClient): Promise<Check[]> {
  const checks: Check[] = [];

  const ping = await supabase.from("projects").select("id", { count: "exact", head: true });
  checks.push(ping.error ? { name: "Database", status: "fail", detail: ping.error.message } : { name: "Database", status: "ok", detail: "Reachable" });

  const open = await openTables(supabase);
  checks.push(
    open === null
      ? { name: "Table privacy", status: "warn", detail: "Can't check: run supabase/migrations/004_rls_guard.sql in the Supabase SQL editor." }
      : open.length
        ? { name: "Table privacy", status: "fail", detail: `Row level security is OFF for: ${open.join(", ")}. Anyone with the public key could read them.` }
        : { name: "Table privacy", status: "ok", detail: "Every table has row level security on" },
  );

  try {
    const e = await embeddingStatus(supabase);
    const missing = Object.values(e.tables).reduce((n, t) => n + t.missing, 0);
    const rows = Object.values(e.tables).reduce((n, t) => n + t.rows, 0);
    checks.push(
      e.running
        ? { name: "Embeddings", status: "warn", detail: `Re-embedding to ${e.job?.target}: ${e.job?.done ?? 0} of ${e.job?.total ?? rows} rows` }
        : e.model !== e.configured
          ? { name: "Embeddings", status: "warn", detail: `The database holds ${e.model} vectors but ${e.configured} is configured. Re-embed to switch.` }
          : missing
            ? { name: "Embeddings", status: "warn", detail: `${missing} of ${rows} rows have no vector yet (filled in automatically when Gemini is reachable)` }
            : { name: "Embeddings", status: "ok", detail: `${rows} rows, all ${e.model} (${e.dim}-d)` },
    );
  } catch (err) {
    checks.push({ name: "Embeddings", status: "fail", detail: err instanceof Error ? err.message : String(err) });
  }

  return checks;
}

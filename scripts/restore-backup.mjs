#!/usr/bin/env node
/**
 * Restore from an "Export Brain" file (Settings → Export, or GET /api/export): the database tables and the
 * app's own state (habits, pet, routines, briefs, check-ins…).
 *
 *   node scripts/restore-backup.mjs second-brain-2026-10-28.json              what would be restored (writes nothing)
 *   node scripts/restore-backup.mjs second-brain-2026-10-28.json --apply      put back what is MISSING (never touches what is there)
 *   node scripts/restore-backup.mjs second-brain-2026-10-28.json --apply --overwrite   also replace what is there with the file's copy
 *
 * Uses SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local, so run it on your own computer. Search vectors
 * (embeddings) are not in the export: notes and memories get theirs back from the scheduler (a few every few
 * minutes); for documents run Settings → Embeddings → re-embed.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const APPLY = args.includes("--apply");
const OVERWRITE = args.includes("--overwrite");
if (!file) {
  console.error("Usage: node scripts/restore-backup.mjs <export.json> [--apply] [--overwrite]");
  process.exit(1);
}

const env = { ...process.env };
try {
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SECRET_KEY not found (.env.local).");
  process.exit(1);
}

const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const backup = JSON.parse(readFileSync(file, "utf8"));
if (!backup || typeof backup !== "object" || !("exported_at" in backup)) {
  console.error("That doesn't look like an export file (no exported_at).");
  process.exit(1);
}
console.log(`Backup from ${backup.exported_at} (version ${backup.version ?? 1}). Mode: ${APPLY ? (OVERWRITE ? "APPLY, overwrite" : "APPLY, only what is missing") : "dry run (nothing is written)"}\n`);

// Parents before children, so every row's foreign keys exist when it goes in.
const TABLES = ["projects", "notes", "memories", "memory_versions", "documents", "document_chunks", "conversations", "messages"];
// Never restored, even if a file has them: they work like keys.
const SECRET = /^(auth|ratelimit|unlock-fails|unlock-fails-all|web-tasks)(\/|$)/;
const SECRET_FILES = new Set(["push-subscriptions", "call-rooms", "device-locations"]);
const BUCKET = "hivemind-private";

async function existingIds(table) {
  const ids = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select("id").order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const r of data) ids.add(r.id);
    if (data.length < 1000) break;
  }
  return ids;
}

let problems = 0;
for (const table of TABLES) {
  const rows = Array.isArray(backup[table]) ? backup[table] : [];
  const have = await existingIds(table);
  const missing = rows.filter((r) => r && r.id && !have.has(r.id));
  const present = rows.length - missing.length;
  const todo = OVERWRITE ? rows.filter((r) => r && r.id) : missing;
  let wrote = 0;
  if (APPLY) {
    for (let i = 0; i < todo.length; i += 200) {
      const batch = todo.slice(i, i + 200);
      const { error } = await sb.from(table).upsert(batch, { onConflict: "id", ignoreDuplicates: !OVERWRITE });
      if (error) {
        problems++;
        console.error(`  ${table}: batch ${i / 200 + 1} failed: ${error.message}`);
      } else wrote += batch.length;
    }
  }
  console.log(`${table.padEnd(16)} in backup ${String(rows.length).padStart(5)} | already there ${String(present).padStart(5)} | missing ${String(missing.length).padStart(5)}${APPLY ? ` | written ${wrote}` : ""}`);
}

const priv = backup.private && typeof backup.private === "object" ? backup.private : {};
let missingFiles = 0, wroteFiles = 0, skipped = 0;
for (const [key, value] of Object.entries(priv)) {
  if (SECRET.test(key) || SECRET_FILES.has(key) || value === null || value === undefined) {
    skipped++;
    continue;
  }
  const { data: there } = await sb.storage.from(BUCKET).download(`${key}.json`);
  if (!there) missingFiles++;
  if (APPLY && (!there || OVERWRITE)) {
    const { error } = await sb.storage.from(BUCKET).upload(`${key}.json`, new Blob([JSON.stringify(value)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
    if (error) {
      problems++;
      console.error(`  private/${key}: ${error.message}`);
    } else wroteFiles++;
  }
}
console.log(`\nprivate files    in backup ${String(Object.keys(priv).length).padStart(5)} | missing ${String(missingFiles).padStart(5)} | skipped (secrets or empty) ${skipped}${APPLY ? ` | written ${wroteFiles}` : ""}`);
console.log(APPLY ? (problems ? `\nDone with ${problems} problem(s): see above.` : "\nDone.") : "\nNothing was written. Add --apply to put back what is missing.");
process.exit(problems ? 2 : 0);

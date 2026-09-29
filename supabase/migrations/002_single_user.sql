-- Switch to single-owner mode: no Supabase Auth users.
-- Run once in Supabase → SQL Editor if you already ran the original schema.sql.
-- Only the server (secret key) touches the database. RLS stays ON with no policies,
-- so the public anon/publishable key can read or write nothing.

do $$
declare t text;
begin
  foreach t in array array['projects','notes','memories','memory_versions','documents','document_chunks','conversations','messages']
  loop
    execute format('drop policy if exists "owner_all" on public.%I', t);
    execute format('alter table public.%I drop column if exists user_id cascade', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create index if not exists notes_updated_idx on public.notes (updated_at desc);
create index if not exists memories_updated_idx on public.memories (updated_at desc);
create index if not exists documents_created_idx on public.documents (created_at desc);

-- Imported sources (portfolio MCP, web pages) are tracked so re-syncs replace instead of duplicate.
alter table public.documents add column if not exists source_url text;
create index if not exists documents_source_url_idx on public.documents (source_url);
create index if not exists memories_source_idx on public.memories ((metadata->>'source'));

alter table public.documents drop constraint if exists documents_file_type_check;

revoke execute on function public.match_knowledge(extensions.vector, int, uuid, float) from anon, authenticated;
revoke execute on function public.keepalive() from anon;

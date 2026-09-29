-- Personal AI Second Brain — Supabase schema
-- Run once in Supabase Dashboard → SQL Editor → New query → paste → Run.
-- Embedding size is fixed at 768 (Gemini gemini-embedding-001 with outputDimensionality=768).
-- Changing the embedding model/dimension later means re-embedding every row.

create extension if not exists vector with schema extensions;

-- ───────────────────────── projects ─────────────────────────
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── notes ─────────────────────────
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  content text not null,
  summary text,
  category text,
  tags jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector(768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── memories ─────────────────────────
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  content text not null,
  memory_type text not null default 'knowledge'
    check (memory_type in ('fact','knowledge','experience','decision','idea','preference','project_context','learning')),
  category text,
  importance int not null default 5 check (importance between 1 and 10),
  confidence real not null default 1.0 check (confidence between 0 and 1),
  tags jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector(768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memory_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  memory_id uuid not null references public.memories(id) on delete cascade,
  version_number int not null,
  title text not null,
  content text not null,
  change_reason text,
  created_at timestamptz not null default now(),
  unique (memory_id, version_number)
);

-- ───────────────────────── documents ─────────────────────────
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  filename text not null,
  file_type text not null,
  status text not null default 'processing' check (status in ('processing','ready','failed')),
  summary text,
  chunk_count int not null default 0,
  error text,
  created_at timestamptz not null default now()
);

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector(768),
  created_at timestamptz not null default now()
);

-- ───────────────────────── chat ─────────────────────────
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ───────────────────────── indexes ─────────────────────────
create index if not exists notes_user_idx on public.notes (user_id, updated_at desc);
create index if not exists memories_user_idx on public.memories (user_id, updated_at desc);
create index if not exists documents_user_idx on public.documents (user_id, created_at desc);
create index if not exists chunks_doc_idx on public.document_chunks (document_id, chunk_index);
create index if not exists versions_memory_idx on public.memory_versions (memory_id, version_number desc);
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at);

create index if not exists notes_embedding_idx on public.notes using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists memories_embedding_idx on public.memories using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists chunks_embedding_idx on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);

-- ───────────────────────── row level security ─────────────────────────
-- Every row belongs to one user; nobody can read or write anyone else's brain.
do $$
declare t text;
begin
  foreach t in array array['projects','notes','memories','memory_versions','documents','document_chunks','conversations','messages']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "owner_all" on public.%I', t);
    execute format(
      'create policy "owner_all" on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- ───────────────────────── semantic search ─────────────────────────
-- security invoker → RLS applies, so results are always scoped to the caller.
create or replace function public.match_knowledge(
  query_embedding extensions.vector(768),
  match_count int default 8,
  filter_project uuid default null,
  min_similarity float default 0.35
)
returns table (
  source_type text,
  source_id uuid,
  parent_id uuid,
  title text,
  content text,
  similarity float,
  created_at timestamptz
)
language sql stable security invoker
set search_path = public, extensions
as $$
  select * from (
    (select 'note'::text, n.id, n.id, n.title, n.content,
            1 - (n.embedding <=> query_embedding), n.created_at
       from public.notes n
      where n.embedding is not null
        and (filter_project is null or n.project_id = filter_project)
      order by n.embedding <=> query_embedding
      limit match_count)
    union all
    (select 'memory'::text, m.id, m.id, m.title, m.content,
            1 - (m.embedding <=> query_embedding), m.created_at
       from public.memories m
      where m.embedding is not null
        and (filter_project is null or m.project_id = filter_project)
      order by m.embedding <=> query_embedding
      limit match_count)
    union all
    (select 'document'::text, c.id, d.id,
            d.filename || coalesce(' (p. ' || (c.metadata->>'page') || ')', ''),
            c.content,
            1 - (c.embedding <=> query_embedding), c.created_at
       from public.document_chunks c
       join public.documents d on d.id = c.document_id
      where c.embedding is not null
        and (filter_project is null or d.project_id = filter_project)
      order by c.embedding <=> query_embedding
      limit match_count)
  ) r (source_type, source_id, parent_id, title, content, similarity, created_at)
  where r.similarity >= min_similarity
  order by r.similarity desc
  limit match_count;
$$;

-- Tiny query used by the daily Vercel cron so the free project never pauses.
create or replace function public.keepalive()
returns timestamptz
language sql stable
as $$ select now(); $$;

grant execute on function public.keepalive() to anon, authenticated;

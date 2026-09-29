-- Jarvis layer: self-understanding profile, auto-organized projects, activity log with undo.
-- Run once in Supabase → SQL Editor (after 002_single_user.sql).

alter table public.projects add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.projects add column if not exists source_key text;
create unique index if not exists projects_source_key_idx on public.projects (source_key) where source_key is not null;
create unique index if not exists projects_name_lower_idx on public.projects (lower(name));

-- One row: what Jarvis understands about its owner. Regenerated from the brain's contents.
create table if not exists public.brain_profile (
  id int primary key default 1 check (id = 1),
  summary text not null,
  facts jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Everything Jarvis does on its own, so the owner can see it and undo it.
create table if not exists public.activity (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  undone boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists activity_created_idx on public.activity (created_at desc);

create index if not exists notes_project_idx on public.notes (project_id);
create index if not exists memories_project_idx on public.memories (project_id);
create index if not exists documents_project_idx on public.documents (project_id);

alter table public.brain_profile enable row level security;
alter table public.activity enable row level security;

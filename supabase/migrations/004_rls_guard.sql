-- Keeps every table private as the schema grows.
-- Run once in Supabase → SQL Editor. Safe to run again.
--
-- Only the server (secret key) uses the database; RLS on with no policies means the public
-- anon/publishable key can read or write nothing. A table created without RLS would be open to
-- that key, so: (1) new tables get RLS turned on automatically, and (2) the app checks daily for
-- any table that slipped through (Settings → System check, and a push alert).

-- (1) A list of public tables with RLS off. Only the server may call it.
create or replace function public.tables_without_rls()
returns table (table_name text)
language sql
security definer
set search_path = ''
as $$
  select c.relname::text
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  order by 1;
$$;
revoke all on function public.tables_without_rls() from public, anon, authenticated;
grant execute on function public.tables_without_rls() to service_role;

-- (2) Every table created in public from now on has RLS on from the start.
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare r record;
begin
  for r in
    select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if r.schema_name = 'public' then
      execute format('alter table %s enable row level security', r.object_identity);
    end if;
  end loop;
end;
$$;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

drop event trigger if exists rls_auto_enable;
create event trigger rls_auto_enable on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();

-- (3) Anything already open, closed now.
do $$
declare t text;
begin
  for t in select table_name from public.tables_without_rls() loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

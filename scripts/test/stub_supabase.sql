-- Minimal stand-ins for the pieces Supabase provides, so the SQL can be tested on plain Postgres.
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_publication where pubname='supabase_realtime') then create publication supabase_realtime; end if;
end $$;

-- Local-only: let the dev backend act as the "authenticated" role like Supabase does
create table if not exists auth.dev_passwords (email text primary key, password text not null);
grant usage on schema public, auth to anon, authenticated;

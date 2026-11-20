-- TEST-ONLY shim: emulates the parts of Supabase the migrations depend on (auth schema, roles,
-- default privileges, realtime publication). Never apply to a real project.
create schema if not exists extensions;
create schema if not exists auth;
do $$ begin
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
exception when duplicate_object then null; end $$;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, phone text unique,
  raw_user_meta_data jsonb not null default '{}', created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create publication supabase_realtime;
grant usage on schema public, extensions, auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
-- Supabase's default privileges: new objects in public are open to API roles (the migrations must revoke this).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- Attendo 001: extensions, enums, tenant/identity tables, settings, auth helpers.
-- Tenant integrity: child tables reference (id, company_id) composite keys so a row can never
-- point at an employee/department/shift of another company.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists postgis with schema extensions;

create schema if not exists app;
revoke all on schema app from public;

create type public.app_role as enum ('super_admin', 'company_admin', 'manager', 'employee');
create type public.attendance_status as enum ('open', 'closed');
create type public.session_status as enum ('active', 'ended');
create type public.interruption_reason as enum
  ('gps_disabled', 'permission_revoked', 'service_killed', 'no_heartbeat', 'low_battery', 'device_shutdown', 'unknown');
create type public.interruption_source as enum ('device_reported', 'server_inferred');
create type public.geofence_type as enum ('office', 'warehouse', 'customer', 'project_site', 'branch');
create type public.geofence_event_type as enum ('enter', 'exit');
create type public.health_status as enum ('healthy', 'degraded', 'interrupted');

create function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create function app.block_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'IMMUTABLE_RECORD: % is not allowed on %', tg_op, tg_table_name using errcode = '42501';
end $$;

-- ---------------------------------------------------------------- companies
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  name text not null check (length(btrim(name)) between 1 and 200),
  timezone text not null default 'Asia/Kolkata',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create function app.validate_timezone() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'INVALID_TIMEZONE: %', new.timezone;
  end if;
  return new;
end $$;
create trigger companies_tz before insert or update of timezone on public.companies
  for each row execute function app.validate_timezone();
create trigger companies_touch before update on public.companies
  for each row execute function app.touch_updated_at();

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  name text not null check (length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (company_id, name),
  unique (id, company_id)
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  name text not null check (length(btrim(name)) between 1 and 120),
  start_time time not null,
  end_time time not null,
  grace_minutes integer not null default 10 check (grace_minutes between 0 and 180),
  working_days smallint[] not null default '{1,2,3,4,5,6}'
    check (cardinality(working_days) > 0 and working_days <@ array[1,2,3,4,5,6,7]::smallint[]),
  created_at timestamptz not null default now(),
  unique (company_id, name),
  unique (id, company_id)
);

-- ---------------------------------------------------------------- employees
-- Login: Employee ID + company code -> server resolves to an internal phone identifier
-- (+999 + 11 digits, a non-routable range) used as the Supabase Auth phone. No SMS is sent.
create sequence app.login_phone_seq start 10000000000 maxvalue 99999999999 no cycle;
create function app.next_login_phone() returns text language sql as
  $$ select '+999' || nextval('app.login_phone_seq')::text $$;

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  user_id uuid unique references auth.users (id) on delete set null,
  employee_code text not null check (employee_code ~ '^[A-Za-z0-9._-]{1,32}$'),
  full_name text not null check (length(btrim(full_name)) between 1 and 200),
  department_id uuid,
  shift_id uuid,
  contact_phone text check (contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  contact_email text check (position('@' in contact_email) > 1),
  login_phone text not null unique default app.next_login_phone() check (login_phone ~ '^\+999[0-9]{11}$'),
  preferred_language text not null default 'en' check (preferred_language in ('en', 'kn', 'hi')),
  is_active boolean not null default true,
  joined_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  foreign key (department_id, company_id) references public.departments (id, company_id),
  foreign key (shift_id, company_id) references public.shifts (id, company_id)
);
create unique index employees_company_code_ci on public.employees (company_id, lower(employee_code));
create index employees_company_active on public.employees (company_id) where is_active;
create trigger employees_touch before update on public.employees
  for each row execute function app.touch_updated_at();

create table public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id),
  role public.app_role not null,
  created_at timestamptz not null default now(),
  check ((role = 'super_admin') = (company_id is null))
);
create index user_roles_company on public.user_roles (company_id);

create table public.manager_assignments (
  company_id uuid not null,
  manager_employee_id uuid not null,
  employee_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (manager_employee_id, employee_id),
  check (manager_employee_id <> employee_id),
  foreign key (manager_employee_id, company_id) references public.employees (id, company_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id)
);
create index manager_assignments_employee on public.manager_assignments (employee_id);

create table public.employee_devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  device_uid text not null check (length(device_uid) between 8 and 128),
  model text, os_version text, app_version text, fcm_token text,
  is_active boolean not null default true,
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz,
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  unique (employee_id, device_uid),
  unique (id, employee_id)
);
create index employee_devices_company on public.employee_devices (company_id);

-- ------------------------------------------------------------ system settings
create table public.system_settings (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies (id) on delete cascade, -- null = global default
  key text not null,
  value jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique nulls not distinct (company_id, key)
);

-- Whitelist + bounds. Unknown keys and out-of-range values are rejected.
create function app.validate_setting() returns trigger language plpgsql as $$
declare b numeric[];
begin
  b := case new.key
    when 'tracking.moving_interval_s' then array[5, 3600]
    when 'tracking.stationary_interval_s' then array[10, 3600]
    when 'tracking.upload_batch_size' then array[1, 500]
    when 'tracking.upload_interval_s' then array[10, 3600]
    when 'checkin.max_accuracy_m' then array[10, 2000]
    when 'analytics.max_accuracy_m' then array[5, 1000]
    when 'analytics.max_speed_mps' then array[5, 200]
    when 'analytics.gap_threshold_s' then array[60, 7200]
    when 'analytics.stationary_radius_m' then array[5, 500]
    when 'analytics.stationary_min_s' then array[60, 7200]
    when 'live.stale_after_s' then array[30, 3600]
    when 'live.offline_after_s' then array[60, 86400]
    when 'health.heartbeat_interval_s' then array[60, 3600]
    when 'health.low_battery_pct' then array[1, 50]
    when 'health.max_clock_drift_s' then array[30, 3600]
    when 'health.max_queue_pending' then array[10, 100000]
    when 'devices.max_active_per_employee' then array[1, 10]
    when 'retention.location_days' then array[30, 3650]
    when 'retention.health_days' then array[7, 730]
    when 'ingest.max_batch_size' then array[1, 2000]
    when 'ingest.max_future_skew_s' then array[0, 3600]
    else null end;
  if b is null then raise exception 'UNKNOWN_SETTING: %', new.key; end if;
  if jsonb_typeof(new.value) <> 'number' or (new.value #>> '{}')::numeric < b[1] or (new.value #>> '{}')::numeric > b[2] then
    raise exception 'SETTING_OUT_OF_RANGE: % must be a number in [%, %]', new.key, b[1], b[2];
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger system_settings_validate before insert or update on public.system_settings
  for each row execute function app.validate_setting();

insert into public.system_settings (company_id, key, value) values
  (null, 'tracking.moving_interval_s', '30'), (null, 'tracking.stationary_interval_s', '120'),
  (null, 'tracking.upload_batch_size', '20'), (null, 'tracking.upload_interval_s', '120'),
  (null, 'checkin.max_accuracy_m', '200'),
  (null, 'analytics.max_accuracy_m', '100'), (null, 'analytics.max_speed_mps', '55'),
  (null, 'analytics.gap_threshold_s', '600'), (null, 'analytics.stationary_radius_m', '30'),
  (null, 'analytics.stationary_min_s', '300'),
  (null, 'live.stale_after_s', '300'), (null, 'live.offline_after_s', '900'),
  (null, 'health.heartbeat_interval_s', '300'), (null, 'health.low_battery_pct', '15'),
  (null, 'health.max_clock_drift_s', '300'), (null, 'health.max_queue_pending', '500'),
  (null, 'devices.max_active_per_employee', '1'),
  (null, 'retention.location_days', '365'), (null, 'retention.health_days', '90'),
  (null, 'ingest.max_batch_size', '500'), (null, 'ingest.max_future_skew_s', '300');

-- ------------------------------------------------------------- helper functions
-- SECURITY DEFINER + empty search_path. Identity always comes from auth.uid(), never from client claims.
create function app.setting_num(p_company uuid, p_key text) returns numeric
language sql stable security definer set search_path = '' as $$
  select (s.value #>> '{}')::numeric
  from public.system_settings s
  where s.key = p_key and (s.company_id = p_company or s.company_id is null)
  order by s.company_id nulls last limit 1 $$;

create function app.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select ur.role from public.user_roles ur
  where ur.user_id = (select auth.uid())
    and (ur.company_id is null or exists (select 1 from public.companies c where c.id = ur.company_id and c.is_active)) $$;

create function app.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select app.my_role()) = 'super_admin', false) $$;

create function app.my_company_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select ur.company_id from public.user_roles ur
  join public.companies c on c.id = ur.company_id and c.is_active
  where ur.user_id = (select auth.uid()) $$;

create function app.my_employee_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select e.id from public.employees e
  join public.companies c on c.id = e.company_id and c.is_active
  where e.user_id = (select auth.uid()) and e.is_active $$;

create function app.managed_employee_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select ma.employee_id from public.manager_assignments ma
  where ma.manager_employee_id = (select app.my_employee_id()) and (select app.my_role()) = 'manager' $$;

create function app.can_view_employee(p_employee uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.employees e
    where e.id = p_employee and (
      (select app.is_super_admin())
      or (e.company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin')
      or e.id = (select app.my_employee_id())
      or e.id in (select app.managed_employee_ids()))) $$;

-- Only service_role (Edge Functions) may resolve a login identifier. Never exposed to clients.
create function public.resolve_employee_login(p_company_code text, p_employee_code text) returns text
language sql stable security definer set search_path = '' as $$
  select e.login_phone from public.employees e join public.companies c on c.id = e.company_id
  where c.code = lower(btrim(p_company_code)) and lower(e.employee_code) = lower(btrim(p_employee_code))
    and e.is_active and c.is_active $$;

-- Guard: identity/tenant columns on employees can only be changed by service_role / super admin.
create function app.protect_employee_columns() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not (select app.is_super_admin()) and
     (new.company_id is distinct from old.company_id or new.user_id is distinct from old.user_id
      or new.login_phone is distinct from old.login_phone or new.employee_code is distinct from old.employee_code) then
    raise exception 'PROTECTED_COLUMN: company_id, user_id, login_phone and employee_code cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger employees_protect before update on public.employees
  for each row execute function app.protect_employee_columns();

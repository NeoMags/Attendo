-- Attendo 002: attendance, tracking sessions, partitioned GPS records, interruptions,
-- device health snapshots, live status. Clients never write these directly (see 006 grants).

create table public.attendance (
  id uuid primary key,                       -- client-generated: makes check-in retries idempotent
  company_id uuid not null,
  employee_id uuid not null,
  work_date date not null,                   -- company-local date of check-in
  status public.attendance_status not null default 'open',
  check_in_at timestamptz not null,          -- device-recorded time, never overwritten
  check_in_received_at timestamptz not null default now(),
  check_in_lat double precision not null check (check_in_lat between -90 and 90),
  check_in_lng double precision not null check (check_in_lng between -180 and 180),
  check_in_accuracy real not null check (check_in_accuracy >= 0),
  check_out_at timestamptz,
  check_out_received_at timestamptz,
  check_out_lat double precision check (check_out_lat between -90 and 90),
  check_out_lng double precision check (check_out_lng between -180 and 180),
  check_out_accuracy real check (check_out_accuracy >= 0),
  late_minutes integer not null default 0 check (late_minutes >= 0),
  worked_seconds integer check (worked_seconds >= 0),
  device_id uuid,
  finalized_at timestamptz,
  corrected_at timestamptz, corrected_by uuid, correction_reason text,
  created_at timestamptz not null default now(),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  foreign key (device_id, employee_id) references public.employee_devices (id, employee_id),
  check ((status = 'open') = (check_out_at is null)),
  check (check_out_at is null or check_out_at > check_in_at),
  unique (id, employee_id)
);
-- Database-level duplicate check-in prevention: one open shift per employee.
create unique index attendance_one_open_per_employee on public.attendance (employee_id) where status = 'open';
create index attendance_company_date on public.attendance (company_id, work_date);
create index attendance_employee_date on public.attendance (employee_id, work_date desc);

-- Finalized attendance is immutable except through admin_correct_attendance (sets app.allow_correction).
create function app.attendance_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'IMMUTABLE_RECORD: attendance cannot be deleted' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.allow_correction', true), '') <> 'on' then
    if old.status = 'closed' then
      raise exception 'IMMUTABLE_RECORD: finalized attendance cannot be modified' using errcode = '42501';
    end if;
    if new.id <> old.id or new.employee_id <> old.employee_id or new.company_id <> old.company_id
       or new.check_in_at <> old.check_in_at or new.check_in_lat <> old.check_in_lat or new.check_in_lng <> old.check_in_lng then
      raise exception 'IMMUTABLE_RECORD: check-in data cannot be modified' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger attendance_guard before update or delete on public.attendance
  for each row execute function app.attendance_guard();

create table public.tracking_sessions (
  id uuid primary key,                       -- client-generated
  company_id uuid not null,
  employee_id uuid not null,
  attendance_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  status public.session_status not null default 'active',
  end_reason text check (end_reason in ('check_out', 'admin_close', 'auto_close')),
  device_id uuid,
  config_snapshot jsonb,
  created_at timestamptz not null default now(),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  foreign key (attendance_id, employee_id) references public.attendance (id, employee_id),
  foreign key (device_id, employee_id) references public.employee_devices (id, employee_id),
  check ((status = 'active') = (ended_at is null)),
  check (ended_at is null or ended_at >= started_at),
  unique (id, employee_id)
);
create unique index tracking_sessions_one_active_per_attendance on public.tracking_sessions (attendance_id) where ended_at is null;
create index tracking_sessions_employee on public.tracking_sessions (employee_id, started_at desc);
create index tracking_sessions_company on public.tracking_sessions (company_id, started_at desc);

-- GPS fixes: monthly range partitions on recorded_at (cheap retention, bounded indexes).
-- recorded_at is the device fix time and is never replaced by the sync time (received_at).
create table public.location_records (
  id uuid not null,                          -- client-generated: duplicate prevention on retry
  company_id uuid not null,
  employee_id uuid not null,
  tracking_session_id uuid not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  geog extensions.geography(Point, 4326) generated always as
    (extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography) stored,
  accuracy real check (accuracy >= 0),
  speed real check (speed >= 0),
  bearing real check (bearing >= 0 and bearing <= 360),
  altitude double precision,
  battery_percentage smallint check (battery_percentage between 0 and 100),
  provider text,
  network_status text check (network_status in ('wifi', 'cellular', 'none', 'other', 'unknown')),
  is_mock boolean not null default false,    -- Android reported a mock/simulated location
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (id, recorded_at),
  foreign key (tracking_session_id, employee_id) references public.tracking_sessions (id, employee_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id)
) partition by range (recorded_at);
create index location_records_session_time on public.location_records (tracking_session_id, recorded_at);
create index location_records_employee_time on public.location_records (employee_id, recorded_at desc);
create index location_records_company_time on public.location_records (company_id, recorded_at desc);
create index location_records_geog on public.location_records using gist (geog);
create table public.location_records_default partition of public.location_records default;
create trigger location_records_immutable before update or delete on public.location_records
  for each row execute function app.block_mutation();

create function app.ensure_location_partitions(p_months_back integer default 1, p_months_ahead integer default 3)
returns integer language plpgsql security definer set search_path = '' as $$
declare m date; n integer := 0; part text; lo timestamptz; hi timestamptz;
begin
  for i in -p_months_back .. p_months_ahead loop
    m := (date_trunc('month', now() at time zone 'UTC') + make_interval(months => i))::date;
    part := format('location_records_y%sm%s', to_char(m, 'YYYY'), to_char(m, 'MM'));
    lo := (m::text || ' 00:00:00+00')::timestamptz;
    hi := ((m + interval '1 month')::date::text || ' 00:00:00+00')::timestamptz;
    if to_regclass(format('public.%I', part)) is not null then continue; end if;
    if exists (select 1 from public.location_records_default d where d.recorded_at >= lo and d.recorded_at < hi) then
      raise warning 'Skipping %: default partition already holds rows in this range', part;
      continue;
    end if;
    execute format('create table public.%I partition of public.location_records for values from (%L) to (%L)', part, lo, hi);
    n := n + 1;
  end loop;
  return n;
end $$;
select app.ensure_location_partitions(1, 3);

create table public.tracking_interruptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  tracking_session_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  reason public.interruption_reason not null default 'unknown',
  source public.interruption_source not null,
  detail text check (length(detail) <= 500),
  created_at timestamptz not null default now(),
  foreign key (tracking_session_id, employee_id) references public.tracking_sessions (id, employee_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  check (ended_at is null or ended_at >= started_at)
);
create index tracking_interruptions_session on public.tracking_interruptions (tracking_session_id, started_at);
create index tracking_interruptions_employee on public.tracking_interruptions (employee_id, started_at desc);

create table public.device_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  device_id uuid not null,
  tracking_session_id uuid,
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  battery_percentage smallint check (battery_percentage between 0 and 100),
  is_charging boolean,
  power_save_mode boolean,
  location_permission text check (location_permission in ('fine', 'coarse', 'denied', 'not_requested')),
  background_location_granted boolean,
  location_services_enabled boolean,
  location_provider text,
  notifications_enabled boolean,
  battery_optimization_exempt boolean,
  network_type text check (network_type in ('wifi', 'cellular', 'none', 'other', 'unknown')),
  queue_pending integer check (queue_pending >= 0),
  oldest_unsynced_at timestamptz,
  app_version text, os_version text, device_model text,
  mock_location_detected boolean not null default false,
  clock_drift_seconds integer,               -- server-measured, only for real-time heartbeats
  foreground_service_alive boolean,
  last_fix_at timestamptz,
  status public.health_status not null,
  status_reasons text[] not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  foreign key (device_id, employee_id) references public.employee_devices (id, employee_id),
  unique (device_id, captured_at)
);
create index device_health_employee_time on public.device_health_snapshots (employee_id, captured_at desc);
create index device_health_company_time on public.device_health_snapshots (company_id, captured_at desc);

-- One row per employee: latest known state. Drives the live map and overview via Realtime.
create table public.employee_live_status (
  employee_id uuid primary key,
  company_id uuid not null,
  is_checked_in boolean not null default false,
  attendance_id uuid,
  tracking_session_id uuid,
  checked_in_at timestamptz,
  last_lat double precision, last_lng double precision, last_accuracy real, last_battery smallint,
  last_recorded_at timestamptz,               -- device fix time
  last_received_at timestamptz,               -- server receipt time
  health_status public.health_status,
  health_reasons text[] not null default '{}',
  last_heartbeat_at timestamptz,              -- server receipt time (device clock cannot fake freshness)
  updated_at timestamptz not null default now(),
  foreign key (employee_id, company_id) references public.employees (id, company_id)
);
create index employee_live_status_company on public.employee_live_status (company_id) where is_checked_in;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.employee_live_status;
  end if;
end $$;

-- Staleness is computed at read time so an old position is never labelled "live".
create view public.employee_status_v with (security_invoker = true) as
select s.employee_id, s.company_id, e.employee_code, e.full_name, e.department_id,
       s.is_checked_in, s.checked_in_at, s.attendance_id, s.tracking_session_id,
       s.last_lat, s.last_lng, s.last_accuracy, s.last_battery, s.last_recorded_at, s.last_received_at,
       s.health_status, s.health_reasons, s.last_heartbeat_at,
       case when s.last_recorded_at is null then null
            else extract(epoch from (now() - s.last_recorded_at))::bigint end as seconds_since_fix,
       case
         when not s.is_checked_in then 'not_tracking'
         when s.last_recorded_at is null then 'no_fix'
         when now() - s.last_recorded_at <= make_interval(secs => app.setting_num(s.company_id, 'live.stale_after_s')) then 'live'
         when now() - s.last_recorded_at <= make_interval(secs => app.setting_num(s.company_id, 'live.offline_after_s')) then 'stale'
         else 'offline' end as freshness
from public.employee_live_status s
join public.employees e on e.id = s.employee_id;

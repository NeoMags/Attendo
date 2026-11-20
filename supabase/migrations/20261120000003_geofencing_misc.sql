-- Attendo 003: geofences + server-side entry/exit detection, notifications, audit log,
-- productivity (metrics-only) table.

create table public.geofences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  name text not null check (length(btrim(name)) between 1 and 120),
  type public.geofence_type not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  geog extensions.geography(Point, 4326) generated always as
    (extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography) stored,
  radius_m numeric(8, 1) not null default 100 check (radius_m between 10 and 50000),
  hysteresis_fixes smallint not null default 2 check (hysteresis_fixes between 1 and 10),
  is_active boolean not null default true,
  notes text check (length(notes) <= 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name),
  unique (id, company_id)
);
create index geofences_geog on public.geofences using gist (geog);
create index geofences_company_active on public.geofences (company_id) where is_active;
create trigger geofences_touch before update on public.geofences for each row execute function app.touch_updated_at();

-- Internal state machine per (employee, geofence). Not readable by clients.
create table public.geofence_state (
  employee_id uuid not null,
  geofence_id uuid not null references public.geofences (id) on delete cascade,
  company_id uuid not null,
  inside boolean not null default false,
  streak_count smallint not null default 0,
  streak_started_at timestamptz,
  last_recorded_at timestamptz,
  primary key (employee_id, geofence_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id)
);

create table public.geofence_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  geofence_id uuid not null,
  tracking_session_id uuid not null,
  event_type public.geofence_event_type not null,
  occurred_at timestamptz not null,           -- first fix of the confirming streak (recorded time)
  confirmed_at timestamptz not null,          -- fix that completed the streak
  fixes_used smallint not null,
  last_accuracy_m real,
  created_at timestamptz not null default now(),
  foreign key (geofence_id, company_id) references public.geofences (id, company_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  foreign key (tracking_session_id, employee_id) references public.tracking_sessions (id, employee_id)
);
create index geofence_events_employee on public.geofence_events (employee_id, occurred_at desc);
create index geofence_events_fence on public.geofence_events (geofence_id, occurred_at desc);
create index geofence_events_company on public.geofence_events (company_id, occurred_at desc);

-- A fix counts only when the accuracy circle is entirely inside (distance + accuracy <= radius) or
-- entirely outside (distance - accuracy >= radius) the fence. Anything else is ambiguous and ignored,
-- so GPS boundary noise is never treated as proof. A transition needs `hysteresis_fixes` consecutive
-- certain fixes. Unknown accuracy is treated as ambiguous.
create function app.process_geofences(p_employee uuid, p_company uuid, p_session uuid,
  p_recorded_at timestamptz, p_lat double precision, p_lng double precision, p_accuracy real)
returns void language plpgsql security definer set search_path = '' as $$
declare g record; st public.geofence_state; d double precision; cls text; want_inside boolean;
begin
  if p_accuracy is null then return; end if;
  for g in select * from public.geofences where company_id = p_company and is_active loop
    d := extensions.st_distance(g.geog,
           extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography);
    cls := case when d + p_accuracy <= g.radius_m then 'in'
                when d - p_accuracy >= g.radius_m then 'out' else 'ambiguous' end;
    insert into public.geofence_state (employee_id, geofence_id, company_id)
      values (p_employee, g.id, p_company) on conflict do nothing;
    select * into st from public.geofence_state where employee_id = p_employee and geofence_id = g.id for update;
    if st.last_recorded_at is not null and p_recorded_at <= st.last_recorded_at then continue; end if; -- out-of-order
    if cls = 'ambiguous' then
      update public.geofence_state set last_recorded_at = p_recorded_at where employee_id = p_employee and geofence_id = g.id;
      continue;
    end if;
    want_inside := (cls = 'in');
    if want_inside = st.inside then
      update public.geofence_state set streak_count = 0, streak_started_at = null, last_recorded_at = p_recorded_at
        where employee_id = p_employee and geofence_id = g.id;       -- agrees with current state: reset streak
    else
      st.streak_count := st.streak_count + 1;
      if st.streak_count = 1 then st.streak_started_at := p_recorded_at; end if;
      if st.streak_count >= g.hysteresis_fixes then
        insert into public.geofence_events (company_id, employee_id, geofence_id, tracking_session_id, event_type,
                                            occurred_at, confirmed_at, fixes_used, last_accuracy_m)
          values (p_company, p_employee, g.id, p_session, (case when want_inside then 'enter' else 'exit' end)::public.geofence_event_type,
                  st.streak_started_at, p_recorded_at, st.streak_count, p_accuracy);
        update public.geofence_state set inside = want_inside, streak_count = 0, streak_started_at = null,
          last_recorded_at = p_recorded_at where employee_id = p_employee and geofence_id = g.id;
      else
        update public.geofence_state set streak_count = st.streak_count, streak_started_at = st.streak_started_at,
          last_recorded_at = p_recorded_at where employee_id = p_employee and geofence_id = g.id;
      end if;
    end if;
  end loop;
end $$;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  employee_id uuid,                            -- null = for company admins
  kind text not null check (length(kind) <= 64),
  title text not null check (length(title) <= 200),
  body text check (length(body) <= 1000),
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  delivered_at timestamptz,
  foreign key (employee_id, company_id) references public.employees (id, company_id)
);
create index notifications_employee on public.notifications (employee_id, created_at desc);
create index notifications_company on public.notifications (company_id, created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  company_id uuid,
  actor_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_company_time on public.audit_logs (company_id, created_at desc);
create index audit_logs_entity on public.audit_logs (entity_type, entity_id);
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function app.block_mutation();

create function app.audit_row() returns trigger language plpgsql security definer set search_path = '' as $$
declare j jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
  values (coalesce((j ->> 'company_id')::uuid, case when tg_table_name = 'companies' then (j ->> 'id')::uuid end),
          (select auth.uid()), tg_op, tg_table_name, coalesce(j ->> 'id', j ->> 'user_id'),
          jsonb_build_object('old', case when tg_op <> 'INSERT' then to_jsonb(old) end,
                             'new', case when tg_op <> 'DELETE' then to_jsonb(new) end));
  return coalesce(new, old);
end $$;
create trigger audit_companies after insert or update or delete on public.companies for each row execute function app.audit_row();
create trigger audit_employees after insert or update or delete on public.employees for each row execute function app.audit_row();
create trigger audit_departments after insert or update or delete on public.departments for each row execute function app.audit_row();
create trigger audit_shifts after insert or update or delete on public.shifts for each row execute function app.audit_row();
create trigger audit_user_roles after insert or update or delete on public.user_roles for each row execute function app.audit_row();
create trigger audit_manager_assignments after insert or update or delete on public.manager_assignments for each row execute function app.audit_row();
create trigger audit_geofences after insert or update or delete on public.geofences for each row execute function app.audit_row();
create trigger audit_system_settings after insert or update or delete on public.system_settings for each row execute function app.audit_row();
create trigger audit_employee_devices after update or delete on public.employee_devices for each row execute function app.audit_row();

-- Metrics only. No composite "productivity score" column by design (product decision D8).
-- Populated by compute_productivity_daily() in Phase 9; formula_version allows recomputation.
create table public.productivity_daily (
  company_id uuid not null,
  employee_id uuid not null,
  work_date date not null,
  late_minutes integer,
  attended_seconds integer,
  tracked_seconds integer,
  coverage_pct numeric(5, 2),
  distance_m_estimated numeric(12, 1),
  moving_seconds integer,
  stationary_seconds integer,
  geofence_visits integer,
  dwell_seconds_by_type jsonb not null default '{}',
  interruption_count integer,
  interruption_seconds integer,
  healthy_pct numeric(5, 2),
  data_sufficiency text not null default 'insufficient' check (data_sufficiency in ('sufficient', 'insufficient')),
  formula_version integer not null default 1,
  computed_at timestamptz not null default now(),
  primary key (employee_id, work_date),
  foreign key (employee_id, company_id) references public.employees (id, company_id)
);
create index productivity_daily_company_date on public.productivity_daily (company_id, work_date);

-- Brute-force throttle for the employee-login Edge Function (service_role only; no client policies).
create table public.login_attempts (
  id bigint generated always as identity primary key,
  identifier text not null,
  ip text,
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);
create index login_attempts_identifier_time on public.login_attempts (identifier, attempted_at desc);
create index login_attempts_ip_time on public.login_attempts (ip, attempted_at desc);

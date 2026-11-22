-- Round 1: exit alerts, per-user notification "seen" state + dashboard layout, field schedules.

-- ---------------------------------------------------------------- per-user preferences
create table public.user_prefs (
  user_id uuid primary key default auth.uid(),
  notif_seen_at timestamptz,
  dashboard_cards jsonb check (dashboard_cards is null or (jsonb_typeof(dashboard_cards) = 'array' and jsonb_array_length(dashboard_cards) <= 40)),
  updated_at timestamptz not null default now()
);
alter table public.user_prefs enable row level security;
create policy user_prefs_select on public.user_prefs for select to authenticated using (user_id = (select auth.uid()));
create policy user_prefs_insert on public.user_prefs for insert to authenticated with check (user_id = (select auth.uid()));
create policy user_prefs_update on public.user_prefs for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update on public.user_prefs to authenticated;
create trigger user_prefs_touch before update on public.user_prefs for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- exit alerts
alter table public.geofences add column alert_on_exit boolean not null default true;

create function app.notify_geofence_exit() returns trigger language plpgsql security definer set search_path = '' as $$
declare emp text; fence text; alert boolean;
begin
  if new.event_type::text <> 'exit' then return new; end if;
  select g.name, g.alert_on_exit into fence, alert from public.geofences g where g.id = new.geofence_id;
  if not alert then return new; end if;
  select e.full_name into emp from public.employees e where e.id = new.employee_id;
  insert into public.notifications (company_id, employee_id, kind, title, body, data)
  values (new.company_id, null, 'geofence_exit', emp || ' left ' || fence,
          'Exit confirmed at ' || to_char(new.occurred_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC',
          jsonb_build_object('employee_id', new.employee_id, 'geofence_id', new.geofence_id, 'event_id', new.id));
  return new;
end $$;
create trigger geofence_events_exit_notify after insert on public.geofence_events
  for each row execute function app.notify_geofence_exit();

-- managers see exit alerts only for their own team (folded into the single select policy)
drop policy notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated using (
  (select app.is_super_admin())
  or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin')
  or employee_id = (select app.my_employee_id())
  or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'manager'
      and kind = 'geofence_exit' and employee_id is null
      and (data ->> 'employee_id')::uuid in (select app.managed_employee_ids())));

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ---------------------------------------------------------------- field schedules
create table public.field_schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  geofence_id uuid,
  title text not null check (length(btrim(title)) between 1 and 120),
  schedule_date date not null,
  start_time time not null,
  end_time time not null,
  notes text check (notes is null or length(notes) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  foreign key (geofence_id, company_id) references public.geofences (id, company_id),
  check (end_time > start_time)
);
create index field_schedules_company_date on public.field_schedules (company_id, schedule_date);
create index field_schedules_employee_date on public.field_schedules (employee_id, schedule_date);
create trigger audit_field_schedules after insert or update or delete on public.field_schedules for each row execute function app.audit_row();
alter table public.field_schedules enable row level security;

create policy field_schedules_select on public.field_schedules for select to authenticated using (
  (select app.is_super_admin())
  or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin')
  or employee_id = (select app.my_employee_id())
  or employee_id in (select app.managed_employee_ids()));
do $$
declare chk constant text := '((select app.my_role()) in (''company_admin'', ''manager'') or (select app.is_super_admin())) and (select app.can_view_employee(employee_id))';
begin
  execute format('create policy field_schedules_insert on public.field_schedules for insert to authenticated with check (%s)', chk);
  execute format('create policy field_schedules_update on public.field_schedules for update to authenticated using (%s) with check (%s)', chk, chk);
  execute format('create policy field_schedules_delete on public.field_schedules for delete to authenticated using (%s)', chk);
end $$;
grant select, insert, update, delete on public.field_schedules to authenticated;

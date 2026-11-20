-- Attendo 005: Row Level Security + explicit privileges.
-- Model: deny by default. Clients get SELECT (RLS-filtered) and writes only where listed below.
-- Everything that records attendance/GPS/health goes through SECURITY DEFINER RPCs (004).

alter table public.companies enable row level security;
alter table public.departments enable row level security;
alter table public.shifts enable row level security;
alter table public.employees enable row level security;
alter table public.user_roles enable row level security;
alter table public.manager_assignments enable row level security;
alter table public.employee_devices enable row level security;
alter table public.system_settings enable row level security;
alter table public.attendance enable row level security;
alter table public.tracking_sessions enable row level security;
alter table public.location_records enable row level security;
alter table public.tracking_interruptions enable row level security;
alter table public.device_health_snapshots enable row level security;
alter table public.employee_live_status enable row level security;
alter table public.geofences enable row level security;
alter table public.geofence_state enable row level security;   -- no policies: internal only
alter table public.geofence_events enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.productivity_daily enable row level security;
alter table public.login_attempts enable row level security;   -- no policies: service_role only

-- Per-employee data visible to: super admin, company admin (own company), the employee, assigned manager.
-- Written as uncorrelated initplans so Postgres evaluates the role lookups once per statement.
do $$
declare t text;
begin
  foreach t in array array['attendance', 'tracking_sessions', 'location_records', 'tracking_interruptions',
      'device_health_snapshots', 'employee_live_status', 'geofence_events', 'productivity_daily', 'employee_devices'] loop
    execute format($f$create policy %I on public.%I for select to authenticated using (
        (select app.is_super_admin())
        or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin')
        or employee_id = (select app.my_employee_id())
        or employee_id in (select app.managed_employee_ids()))$f$, t || '_select', t);
  end loop;
end $$;

create policy companies_select on public.companies for select to authenticated
  using ((select app.is_super_admin()) or id = (select app.my_company_id()));
create policy companies_write_super on public.companies for all to authenticated
  using ((select app.is_super_admin())) with check ((select app.is_super_admin()));

-- Reference data: readable by everyone in the company; managed by company admins.
do $$
declare t text;
begin
  foreach t in array array['departments', 'shifts', 'geofences'] loop
    execute format($f$create policy %I on public.%I for select to authenticated using (
        (select app.is_super_admin()) or company_id = (select app.my_company_id()))$f$, t || '_select', t);
    execute format($f$create policy %I on public.%I for all to authenticated
      using ((select app.is_super_admin()) or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin'))
      with check ((select app.is_super_admin()) or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin'))$f$,
      t || '_write', t);
  end loop;
end $$;

create policy employees_select on public.employees for select to authenticated using (
  (select app.is_super_admin())
  or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin')
  or id = (select app.my_employee_id())
  or id in (select app.managed_employee_ids()));
create policy employees_update_admin on public.employees for update to authenticated
  using ((select app.is_super_admin()) or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin'))
  with check ((select app.is_super_admin()) or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin'));
-- Employees are created by the admin-create-employee Edge Function (service_role); no client INSERT/DELETE.

create policy user_roles_select on public.user_roles for select to authenticated using (
  user_id = (select auth.uid()) or (select app.is_super_admin())
  or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin'));
-- Role changes: service_role only (Edge Function), never from clients.

create policy manager_assignments_select on public.manager_assignments for select to authenticated using (
  (select app.is_super_admin())
  or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin')
  or manager_employee_id = (select app.my_employee_id()));
create policy manager_assignments_write on public.manager_assignments for all to authenticated
  using ((select app.is_super_admin()) or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin'))
  with check ((select app.is_super_admin()) or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin'));

create policy employee_devices_update_admin on public.employee_devices for update to authenticated
  using ((select app.is_super_admin()) or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin'))
  with check ((select app.is_super_admin()) or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin'));

create policy system_settings_select on public.system_settings for select to authenticated using (
  company_id is null or company_id = (select app.my_company_id()) or (select app.is_super_admin()));
create policy system_settings_write_company on public.system_settings for all to authenticated
  using (company_id is not null and company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin')
  with check (company_id is not null and company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin');
create policy system_settings_write_super on public.system_settings for all to authenticated
  using ((select app.is_super_admin())) with check ((select app.is_super_admin()));

create policy notifications_select on public.notifications for select to authenticated using (
  (select app.is_super_admin())
  or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin')
  or employee_id = (select app.my_employee_id()));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (employee_id = (select app.my_employee_id())) with check (employee_id = (select app.my_employee_id()));

create policy audit_logs_select on public.audit_logs for select to authenticated using (
  (select app.is_super_admin())
  or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin'));

-- ------------------------------------------------------------------ privileges
-- Supabase grants broad defaults to anon/authenticated on new objects; remove them, then grant minimally.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant usage on schema app to authenticated, service_role;
grant select on public.companies, public.departments, public.shifts, public.employees, public.user_roles,
  public.manager_assignments, public.employee_devices, public.system_settings, public.attendance,
  public.tracking_sessions, public.location_records, public.tracking_interruptions, public.device_health_snapshots,
  public.employee_live_status, public.geofences, public.geofence_events, public.notifications, public.audit_logs,
  public.productivity_daily, public.employee_status_v to authenticated;
grant insert, update, delete on public.companies, public.departments, public.shifts, public.geofences,
  public.manager_assignments, public.system_settings to authenticated;       -- RLS limits to admins
grant update on public.employees to authenticated;                           -- RLS: admins; protected cols trigger
grant update (is_active) on public.employee_devices to authenticated;        -- RLS: admins deactivate devices
grant update (read_at) on public.notifications to authenticated;             -- RLS: own rows
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- helpers used inside RLS expressions
grant execute on function app.my_role(), app.is_super_admin(), app.my_company_id(), app.my_employee_id(),
  app.managed_employee_ids(), app.can_view_employee(uuid), app.setting_num(uuid, text) to authenticated, service_role;
grant execute on function app.next_login_phone(), app.ensure_location_partitions(integer, integer), app.purge_expired() to service_role;

-- client RPCs
grant execute on function public.register_device(text, text, text, text, text),
  public.check_in(uuid, uuid, text, timestamptz, double precision, double precision, real),
  public.check_out(uuid, timestamptz, double precision, double precision, real),
  public.ingest_locations(uuid, jsonb), public.record_heartbeat(jsonb),
  public.report_interruption(uuid, uuid, timestamptz, timestamptz, text, text),
  public.get_tracking_config(), public.log_admin_access(text, uuid, jsonb),
  public.admin_correct_attendance(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.resolve_employee_login(text, text) to service_role;   -- Edge Functions only

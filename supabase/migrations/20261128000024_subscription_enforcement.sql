-- Subscription enforcement (Phase D): server-side employee cap, read-only writes once a plan lapses,
-- manager visibility of the subscription banner, and a service-role state lookup for Edge Functions.

-- ---------------------------------------------------------------- employee cap
-- Applies to every writer (including the service role used by Edge Functions). The advisory lock serialises
-- concurrent hires in the same company so two requests cannot both take the last seat.
create function app.enforce_employee_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_max integer; v_count bigint;
begin
  if not new.is_active then return new; end if;
  if tg_op = 'UPDATE' and old.is_active and old.company_id = new.company_id then return new; end if;
  select s.max_employees into v_max from public.company_subscriptions s where s.company_id = new.company_id;
  if v_max is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('employee-cap:' || new.company_id::text, 0));
  select count(*) into v_count from public.employees e
  where e.company_id = new.company_id and e.is_active and e.id <> new.id;
  if v_count >= v_max then raise exception 'EMPLOYEE_LIMIT_REACHED'; end if;
  return new;
end $$;
create trigger employees_cap before insert or update of is_active, company_id on public.employees
  for each row execute function app.enforce_employee_cap();

-- ---------------------------------------------------------------- write guard
-- Statement-level: a signed-in user can only ever write their own company's rows, so the caller's company decides.
-- No auth.uid() (service role, migrations, cron) -> allowed; the Edge Functions check state themselves where it matters.
--   company_admin / manager : blocked when the plan is in grace or expired (dashboard is read-only)
--   employee                : blocked only once expired (the employee app keeps working through the grace window)
--   super_admin             : never blocked
create function app.guard_subscription_writes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_role text; v_company uuid; v_state text;
begin
  if (select auth.uid()) is null then return null; end if;
  v_role := (select app.my_role())::text;
  if v_role is null or v_role = 'super_admin' then return null; end if;
  v_company := (select app.my_company_id());
  if v_company is null then return null; end if;
  v_state := app.subscription_state(v_company);
  if (v_role in ('company_admin', 'manager') and v_state in ('grace', 'expired'))
     or (v_role = 'employee' and v_state = 'expired') then
    raise exception 'SUBSCRIPTION_EXPIRED';
  end if;
  return null;
end $$;

do $$
declare tbl text;
begin
  foreach tbl in array array[
    'advance_recoveries', 'attendance', 'company_holidays', 'company_settings', 'departments', 'device_health_snapshots',
    'employee_advances', 'employee_devices', 'employee_live_status', 'employee_payroll_info', 'employee_profiles', 'employees',
    'field_schedules', 'geofence_events', 'geofence_state', 'geofences', 'leave_requests', 'leave_types', 'ledger_entries',
    'manager_assignments', 'payroll_runs', 'payslip_templates', 'payslips', 'productivity_daily', 'shifts', 'statutory_filings',
    'system_settings', 'tasks', 'tax_declarations', 'tracking_interruptions', 'tracking_sessions']
  loop
    if to_regclass('public.' || tbl) is not null then
      execute format('create trigger subscription_guard before insert or update or delete on public.%I
        for each statement execute function app.guard_subscription_writes()', tbl);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- reads
create or replace function public.my_subscription()
returns table (state text, plan_name text, max_employees integer, employee_count bigint, expires_on date, days_left integer, is_complimentary boolean)
language sql stable security definer set search_path = '' as $$
  select app.subscription_state(s.company_id), s.plan_name, s.max_employees,
         (select count(*) from public.employees e where e.company_id = s.company_id and e.is_active),
         s.expires_on, (s.expires_on - app.platform_today()), s.is_complimentary
  from public.company_subscriptions s
  where s.company_id = (select app.my_company_id()) and (select app.my_role())::text in ('company_admin', 'manager') $$;

-- Edge Functions run as service_role and can only call the public schema through PostgREST.
create function public.subscription_state_for(p_company uuid) returns text
language sql stable security definer set search_path = '' as $$ select app.subscription_state(p_company) $$;
revoke all on function public.subscription_state_for(uuid) from public, anon, authenticated;
grant execute on function public.subscription_state_for(uuid) to service_role;

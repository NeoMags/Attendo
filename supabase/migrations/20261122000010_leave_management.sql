-- Attendo 010: leave management (types with yearly quota, two-level approval: manager, then admin).
-- Clients never write leave_requests directly: apply_leave / decide_leave / cancel_leave enforce every rule.
create extension if not exists btree_gist with schema extensions;

create type public.leave_status as enum ('pending', 'manager_approved', 'approved', 'rejected', 'cancelled');

create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  name text not null check (length(btrim(name)) between 1 and 60),
  annual_quota_days numeric(5,1) check (annual_quota_days is null or annual_quota_days between 0 and 366), -- null = unlimited
  is_paid boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name),
  unique (id, company_id)
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  leave_type_id uuid not null,
  start_date date not null,
  end_date date not null,
  is_half_day boolean not null default false,
  days numeric(5,1) not null check (days > 0),   -- working days in the range per the employee's shift (holidays are not modelled)
  reason text check (reason is null or length(reason) <= 500),
  status public.leave_status not null default 'pending',
  manager_decided_by uuid, manager_decided_at timestamptz, manager_note text check (manager_note is null or length(manager_note) <= 300),
  decided_by uuid, decided_at timestamptz, decision_note text check (decision_note is null or length(decision_note) <= 300),
  created_at timestamptz not null default now(),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  foreign key (leave_type_id, company_id) references public.leave_types (id, company_id),
  check (end_date >= start_date),
  check (end_date - start_date <= 92),
  check (extract(year from start_date) = extract(year from end_date)),   -- keeps yearly balances unambiguous
  check (not is_half_day or start_date = end_date),
  constraint leave_requests_no_overlap exclude using gist (
    employee_id extensions.gist_uuid_ops with =,
    (daterange(start_date, end_date, '[]')) with &&
  ) where (status in ('pending', 'manager_approved', 'approved'))
);
create index leave_requests_company_status on public.leave_requests (company_id, status, start_date);
create index leave_requests_employee_start on public.leave_requests (employee_id, start_date);

create trigger audit_leave_types after insert or update or delete on public.leave_types for each row execute function app.audit_row();
create trigger audit_leave_requests after insert or update or delete on public.leave_requests for each row execute function app.audit_row();

-- ---------------------------------------------------------------- RLS
alter table public.leave_types enable row level security;
alter table public.leave_requests enable row level security;

create policy leave_types_select on public.leave_types for select to authenticated
  using ((select app.is_super_admin()) or company_id = (select app.my_company_id()));
do $$
declare admin_chk constant text := '((select app.is_super_admin()) or (company_id = (select app.my_company_id()) and (select app.my_role()) = ''company_admin''))';
begin
  execute format('create policy leave_types_insert on public.leave_types for insert to authenticated with check (%s)', admin_chk);
  execute format('create policy leave_types_update on public.leave_types for update to authenticated using (%s) with check (%s)', admin_chk, admin_chk);
  execute format('create policy leave_types_delete on public.leave_types for delete to authenticated using (%s)', admin_chk);
end $$;

create policy leave_requests_select on public.leave_requests for select to authenticated using (
  (select app.is_super_admin())
  or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin')
  or employee_id = (select app.my_employee_id())
  or employee_id in (select app.managed_employee_ids()));

grant select on public.leave_requests to authenticated;               -- writes only through the RPCs below
grant select, insert, update, delete on public.leave_types to authenticated;   -- RLS limits writes to admins

-- ---------------------------------------------------------------- helpers
-- Working days in [start, end] per the employee's shift (Mon-Sat when no shift is assigned). Half day = 0.5 on a working day.
create function app.leave_days(p_employee uuid, p_start date, p_end date, p_half boolean) returns numeric
language sql stable security definer set search_path = '' as $$
  with wd as (
    select coalesce((select s.working_days from public.employees e join public.shifts s on s.id = e.shift_id and s.company_id = e.company_id
                     where e.id = p_employee), '{1,2,3,4,5,6}'::smallint[]) as d)
  select case when p_half then (select case when extract(isodow from p_start)::smallint = any (wd.d) then 0.5 else 0 end from wd)
         else (select count(*) from wd, generate_series(p_start, p_end, interval '1 day') g
               where extract(isodow from g)::smallint = any (wd.d))::numeric end $$;

create function app.notify_leave(p_company uuid, p_employee uuid, p_title text, p_body text, p_request uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (company_id, employee_id, kind, title, body, data)
  values (p_company, p_employee, 'leave', p_title, p_body, jsonb_build_object('leave_request_id', p_request)) $$;

-- ---------------------------------------------------------------- RPCs
create function public.apply_leave(p_leave_type_id uuid, p_start date, p_end date, p_half_day boolean default false, p_reason text default null)
returns public.leave_requests language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := (select app.my_employee_id()); v_company uuid; v_tz text; v_today date; lt public.leave_types;
  v_days numeric; v_used numeric; r public.leave_requests; m record; v_notified boolean := false;
begin
  if v_emp is null then raise exception 'NO_EMPLOYEE' using errcode = '42501'; end if;
  select e.company_id, c.timezone into v_company, v_tz from public.employees e join public.companies c on c.id = e.company_id where e.id = v_emp;
  -- serialise per employee so concurrent requests cannot both pass the balance/overlap checks
  perform 1 from public.employees where id = v_emp for update;
  select * into lt from public.leave_types where id = p_leave_type_id and company_id = v_company and is_active;
  if not found then raise exception 'LEAVE_TYPE_NOT_FOUND'; end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 92 or extract(year from p_start) <> extract(year from p_end)
     or (coalesce(p_half_day, false) and p_start <> p_end) then raise exception 'INVALID_DATES'; end if;
  v_today := (now() at time zone v_tz)::date;
  if p_start < v_today - 30 then raise exception 'DATE_TOO_OLD'; end if;
  if p_end > v_today + 366 then raise exception 'DATE_TOO_FAR'; end if;
  v_days := app.leave_days(v_emp, p_start, p_end, coalesce(p_half_day, false));
  if v_days <= 0 then raise exception 'NO_WORKING_DAYS'; end if;
  if lt.annual_quota_days is not null then
    select coalesce(sum(days), 0) into v_used from public.leave_requests
      where employee_id = v_emp and leave_type_id = lt.id and status in ('pending', 'manager_approved', 'approved')
        and extract(year from start_date) = extract(year from p_start);
    if v_used + v_days > lt.annual_quota_days then raise exception 'INSUFFICIENT_BALANCE'; end if;
  end if;
  begin
    insert into public.leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, is_half_day, days, reason)
      values (v_company, v_emp, lt.id, p_start, p_end, coalesce(p_half_day, false), v_days, nullif(btrim(p_reason), ''))
      returning * into r;
  exception when exclusion_violation then raise exception 'LEAVE_OVERLAP'; end;
  for m in select manager_employee_id from public.manager_assignments where employee_id = v_emp loop
    perform app.notify_leave(v_company, m.manager_employee_id, 'New leave request', lt.name || ' ' || p_start || ' to ' || p_end, r.id); v_notified := true;
  end loop;
  if not v_notified then perform app.notify_leave(v_company, null, 'New leave request', lt.name || ' ' || p_start || ' to ' || p_end, r.id); end if;
  return r;
end $$;

-- Manager: pending -> manager_approved | rejected.  Admin: pending|manager_approved -> approved | rejected.
create function public.decide_leave(p_request_id uuid, p_approve boolean, p_note text default null)
returns public.leave_requests language plpgsql security definer set search_path = '' as $$
declare r public.leave_requests; v_is_admin boolean; v_is_mgr boolean; v_note text := nullif(btrim(p_note), '');
begin
  select * into r from public.leave_requests where id = p_request_id for update;
  if not found then raise exception 'LEAVE_NOT_FOUND'; end if;
  v_is_admin := (select app.is_super_admin()) or ((select app.my_role()) = 'company_admin' and r.company_id = (select app.my_company_id()));
  v_is_mgr := (select app.my_role()) = 'manager' and r.employee_id in (select app.managed_employee_ids());
  if not (v_is_admin or v_is_mgr) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if r.employee_id = (select app.my_employee_id()) then raise exception 'SELF_APPROVAL_NOT_ALLOWED' using errcode = '42501'; end if;
  if p_approve is null then raise exception 'INVALID_DECISION'; end if;
  if not p_approve and (v_note is null or length(v_note) < 3) then raise exception 'NOTE_REQUIRED'; end if;
  if v_note is not null and length(v_note) > 300 then raise exception 'NOTE_TOO_LONG'; end if;
  if v_is_admin then
    if r.status not in ('pending', 'manager_approved') then raise exception 'INVALID_STATE'; end if;
    update public.leave_requests set status = case when p_approve then 'approved' else 'rejected' end::public.leave_status,
      decided_by = (select auth.uid()), decided_at = now(), decision_note = v_note where id = r.id returning * into r;
  else
    if r.status <> 'pending' then raise exception 'INVALID_STATE'; end if;
    if p_approve then
      update public.leave_requests set status = 'manager_approved', manager_decided_by = (select auth.uid()), manager_decided_at = now(), manager_note = v_note
        where id = r.id returning * into r;
    else
      update public.leave_requests set status = 'rejected', manager_decided_by = (select auth.uid()), manager_decided_at = now(), manager_note = v_note,
        decided_by = (select auth.uid()), decided_at = now(), decision_note = v_note where id = r.id returning * into r;
    end if;
  end if;
  perform app.notify_leave(r.company_id, r.employee_id,
    case r.status when 'approved' then 'Leave approved' when 'rejected' then 'Leave rejected' else 'Leave approved by manager' end,
    r.start_date || ' to ' || r.end_date, r.id);
  return r;
end $$;

create function public.cancel_leave(p_request_id uuid) returns public.leave_requests
language plpgsql security definer set search_path = '' as $$
declare r public.leave_requests; v_emp uuid := (select app.my_employee_id()); v_today date;
begin
  select * into r from public.leave_requests where id = p_request_id and employee_id = v_emp for update;
  if not found or v_emp is null then raise exception 'LEAVE_NOT_FOUND'; end if;
  select (now() at time zone c.timezone)::date into v_today from public.companies c where c.id = r.company_id;
  if not (r.status in ('pending', 'manager_approved') or (r.status = 'approved' and r.start_date > v_today)) then raise exception 'INVALID_STATE'; end if;
  update public.leave_requests set status = 'cancelled' where id = r.id returning * into r;
  return r;
end $$;

-- Balance per active leave type for one employee and year. SECURITY INVOKER: RLS decides whose balances the caller may see.
create function public.leave_balances(p_employee_id uuid, p_year integer)
returns table (leave_type_id uuid, name text, annual_quota_days numeric, approved_days numeric, pending_days numeric, remaining_days numeric)
language sql stable set search_path = '' as $$
  select t.id, t.name, t.annual_quota_days,
         coalesce(sum(r.days) filter (where r.status = 'approved'), 0),
         coalesce(sum(r.days) filter (where r.status in ('pending', 'manager_approved')), 0),
         case when t.annual_quota_days is null then null
              else t.annual_quota_days - coalesce(sum(r.days) filter (where r.status in ('pending', 'manager_approved', 'approved')), 0) end
  from public.leave_types t
  join public.employees e on e.id = p_employee_id and e.company_id = t.company_id
  left join public.leave_requests r on r.leave_type_id = t.id and r.employee_id = p_employee_id and extract(year from r.start_date) = p_year
  where t.is_active
  group by t.id, t.name, t.annual_quota_days
  order by t.name $$;

revoke all on function public.apply_leave(uuid, date, date, boolean, text), public.decide_leave(uuid, boolean, text),
  public.cancel_leave(uuid), public.leave_balances(uuid, integer) from public, anon;
grant execute on function public.apply_leave(uuid, date, date, boolean, text), public.decide_leave(uuid, boolean, text),
  public.cancel_leave(uuid), public.leave_balances(uuid, integer) to authenticated;

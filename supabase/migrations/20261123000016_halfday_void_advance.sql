-- Round 4 follow-ups: half-day attendance, voiding advances. Additive.

-- ---------------------------------------------------------------- half-day attendance
-- A shift may define how long someone must work for a full day / half day. Both null = any attendance is a full day (previous behaviour).
alter table public.shifts
  add column full_day_minutes integer check (full_day_minutes is null or full_day_minutes between 30 and 1440),
  add column half_day_minutes integer check (half_day_minutes is null or half_day_minutes between 15 and 1440),
  add constraint shifts_day_thresholds check ((full_day_minutes is null) = (half_day_minutes is null) and (half_day_minutes is null or half_day_minutes < full_day_minutes));

-- An admin can override the day's value (e.g. 0.5 for a half day, or 1 to waive a short day).
alter table public.attendance
  add column day_fraction_override numeric(2,1) check (day_fraction_override in (0, 0.5, 1)),
  add column fraction_reason text check (fraction_reason is null or length(fraction_reason) <= 300);

create function public.set_attendance_fraction(p_attendance uuid, p_fraction numeric, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.attendance;
begin
  select * into a from public.attendance where id = p_attendance for update;
  if not found then raise exception 'ATTENDANCE_NOT_FOUND'; end if;
  if not app.is_company_admin(a.company_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_fraction is not null and p_fraction not in (0, 0.5, 1) then raise exception 'INVALID_FRACTION'; end if;
  perform set_config('app.allow_correction', 'on', true);   -- finalized rows are otherwise immutable; this touches only the override columns
  update public.attendance set day_fraction_override = p_fraction, fraction_reason = nullif(btrim(p_reason), '') where id = a.id;
  perform set_config('app.allow_correction', 'off', true);
  insert into public.audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
    values (a.company_id, (select auth.uid()), 'FRACTION', 'attendance', a.id::text, jsonb_build_object('fraction', p_fraction, 'reason', p_reason));
end $$;
revoke all on function public.set_attendance_fraction(uuid, numeric, text) from public, anon;
grant execute on function public.set_attendance_fraction(uuid, numeric, text) to authenticated;

-- Value of one attendance row: 1, 0.5 or 0. Unknown hours (never checked out) count as a full day rather than guessing.
create function app.day_fraction(p_override numeric, p_worked_seconds integer, p_full integer, p_half integer) returns numeric
language sql immutable set search_path = '' as $$
  select case
    when p_override is not null then p_override
    when p_full is null or p_worked_seconds is null then 1
    when p_worked_seconds / 60.0 >= p_full then 1
    when p_worked_seconds / 60.0 >= p_half then 0.5
    else 0 end $$;

create or replace function app.payroll_days(p_employee uuid, p_month date)
returns table (working_days integer, present_days numeric, holiday_days numeric, paid_leave_days numeric, unpaid_leave_days numeric, absent_days numeric)
language sql stable security definer set search_path = '' as $$
  with e as (
    select e.company_id, e.joined_on, coalesce(s.working_days, '{1,2,3,4,5,6}'::smallint[]) as wd, s.full_day_minutes as fm, s.half_day_minutes as hm
    from public.employees e left join public.shifts s on s.id = e.shift_id and s.company_id = e.company_id where e.id = p_employee),
  rng as (select p_month as m0, (p_month + interval '1 month - 1 day')::date as m1),
  days as (
    select g::date as d from e, rng, generate_series(rng.m0, rng.m1, interval '1 day') g
    where extract(isodow from g)::smallint = any (e.wd) and (e.joined_on is null or g::date >= e.joined_on)),
  pres as (
    select a.work_date as d, max(app.day_fraction(a.day_fraction_override, a.worked_seconds, e.fm, e.hm)) as f
    from public.attendance a, rng, e where a.employee_id = p_employee and a.work_date between rng.m0 and rng.m1 group by a.work_date),
  hol as (select h.holiday_date as d from public.company_holidays h, e, rng where h.company_id = e.company_id and h.holiday_date between rng.m0 and rng.m1),
  lv as (
    select g::date as d, sum(case when r.is_half_day then 0.5 else 1 end) as qty, bool_and(coalesce(r.is_paid, true)) as paid
    from public.leave_requests r, rng, generate_series(greatest(r.start_date, rng.m0), least(r.end_date, rng.m1), interval '1 day') g
    where r.employee_id = p_employee and r.status = 'approved' group by g::date),
  x as (
    select coalesce(p.f, 0) as f, (h.d is not null) as is_hol, coalesce(l.qty, 0) as qty, coalesce(l.paid, true) as paid
    from days dd left join pres p on p.d = dd.d left join hol h on h.d = dd.d left join lv l on l.d = dd.d),
  y as (
    select f, 1 - f as rem, is_hol, qty, paid,
           case when is_hol then 1 - f else 0 end as hol_part,
           case when is_hol then 0 else least(1 - f, qty) end as lv_part
    from x)
  select count(*)::integer, coalesce(sum(f), 0),
    coalesce(sum(hol_part), 0),
    coalesce(sum(lv_part) filter (where paid), 0),
    coalesce(sum(lv_part) filter (where not paid), 0),
    coalesce(sum(rem - hol_part - lv_part), 0)
  from y $$;

-- ---------------------------------------------------------------- void an advance
alter type public.ledger_kind add value if not exists 'advance_voided';
alter table public.ledger_entries drop constraint ledger_entries_direction_check;
alter table public.ledger_entries add constraint ledger_entries_direction_check check (direction in ('to_employee', 'from_employee', 'waived'));

alter table public.employee_advances
  add column voided_at timestamptz, add column voided_by uuid,
  add column void_reason text check (void_reason is null or length(void_reason) <= 300);

create or replace view public.advance_balances with (security_invoker = true) as
  select a.id, a.company_id, a.employee_id, a.amount, a.given_on, a.reason, a.monthly_deduction,
         coalesce((select sum(r.amount) from public.advance_recoveries r where r.advance_id = a.id), 0)::numeric(12,2) as recovered,
         (case when a.voided_at is not null then 0
               else a.amount - coalesce((select sum(r.amount) from public.advance_recoveries r where r.advance_id = a.id), 0) end)::numeric(12,2) as remaining,
         (a.voided_at is not null) as voided, a.void_reason
  from public.employee_advances a;

-- Cancels (nothing recovered yet) or writes off (partly recovered) what is still owed. Money already recovered stays in the history.
create function public.void_advance(p_advance uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.employee_advances; v_left numeric(12,2); v_today date; v_rec numeric(12,2);
begin
  select * into a from public.employee_advances where id = p_advance for update;
  if not found then raise exception 'ADVANCE_NOT_FOUND'; end if;
  if not app.is_company_admin(a.company_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if a.voided_at is not null then raise exception 'ALREADY_VOIDED'; end if;
  select coalesce(sum(r.amount), 0) into v_rec from public.advance_recoveries r where r.advance_id = a.id;
  v_left := a.amount - v_rec;
  if v_left <= 0 then raise exception 'NOTHING_TO_VOID'; end if;
  select (now() at time zone c.timezone)::date into v_today from public.companies c where c.id = a.company_id;
  update public.employee_advances set voided_at = now(), voided_by = (select auth.uid()), void_reason = nullif(btrim(p_reason), '') where id = a.id;
  insert into public.ledger_entries (company_id, employee_id, entry_date, kind, amount, direction, ref_id, note)
    values (a.company_id, a.employee_id, v_today, 'advance_voided', v_left, 'waived', a.id,
            case when v_rec = 0 then 'Advance cancelled' else 'Balance written off' end || coalesce(': ' || nullif(btrim(p_reason), ''), ''));
  -- draft payslips of this employee no longer recover it
  perform app.payslip_settle(p.id) from public.payslips p where p.employee_id = a.employee_id and not p.finalized;
end $$;
revoke all on function public.void_advance(uuid, text) from public, anon;
grant execute on function public.void_advance(uuid, text) to authenticated;

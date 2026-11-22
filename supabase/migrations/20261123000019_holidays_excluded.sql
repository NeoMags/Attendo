-- Holidays are excluded from working days (not paid as extra days). holiday_days is kept in the result as 0 so existing payslips/PDFs keep their shape.
create or replace function app.payroll_days(p_employee uuid, p_month date)
returns table (working_days integer, present_days numeric, holiday_days numeric, paid_leave_days numeric, unpaid_leave_days numeric, absent_days numeric)
language sql stable security definer set search_path = '' as $$
  with e as (
    select e.company_id, e.joined_on, coalesce(s.working_days, '{1,2,3,4,5,6}'::smallint[]) as wd, s.full_day_minutes as fm, s.half_day_minutes as hm
    from public.employees e left join public.shifts s on s.id = e.shift_id and s.company_id = e.company_id where e.id = p_employee),
  rng as (select p_month as m0, (p_month + interval '1 month - 1 day')::date as m1),
  hol as (select h.holiday_date as d from public.company_holidays h, e, rng where h.company_id = e.company_id and h.holiday_date between rng.m0 and rng.m1),
  days as (
    select g::date as d from e, rng, generate_series(rng.m0, rng.m1, interval '1 day') g
    where extract(isodow from g)::smallint = any (e.wd) and (e.joined_on is null or g::date >= e.joined_on)
      and not exists (select 1 from hol where hol.d = g::date)),
  pres as (
    select a.work_date as d, max(app.day_fraction(a.day_fraction_override, a.worked_seconds, e.fm, e.hm)) as f
    from public.attendance a, rng, e where a.employee_id = p_employee and a.work_date between rng.m0 and rng.m1 group by a.work_date),
  lv as (
    select g::date as d, sum(case when r.is_half_day then 0.5 else 1 end) as qty, bool_and(coalesce(r.is_paid, true)) as paid
    from public.leave_requests r, rng, generate_series(greatest(r.start_date, rng.m0), least(r.end_date, rng.m1), interval '1 day') g
    where r.employee_id = p_employee and r.status = 'approved' group by g::date),
  x as (
    select coalesce(p.f, 0) as f, false as is_hol, coalesce(l.qty, 0) as qty, coalesce(l.paid, true) as paid
    from days dd left join pres p on p.d = dd.d left join lv l on l.d = dd.d),
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

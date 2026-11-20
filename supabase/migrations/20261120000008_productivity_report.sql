-- Metrics-only productivity report. SECURITY INVOKER: row-level security decides which employees a caller sees.
-- Reports measurements only (presence, tracked time, distance, interruptions); it computes no score or ranking.
create or replace function public.productivity_report(p_company_id uuid, p_from date, p_to date)
returns table (
  employee_id uuid, employee_code text, full_name text,
  days_present integer, late_days integer, worked_seconds bigint,
  tracked_seconds bigint, distance_m double precision, location_points bigint,
  interruptions integer, interruption_seconds bigint
)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
begin
  if p_from is null or p_to is null or p_from > p_to then raise exception 'INVALID_RANGE'; end if;
  if p_to - p_from > 92 then raise exception 'RANGE_TOO_LARGE'; end if;
  return query
  with att as (
    select a.id, a.employee_id, a.work_date, a.late_minutes, a.worked_seconds, a.check_in_at,
           coalesce(a.check_out_at, least(now(), a.check_in_at + interval '24 hours')) as end_at
    from public.attendance a
    where a.company_id = p_company_id and a.work_date between p_from and p_to
  ), att_agg as (
    select employee_id, count(distinct work_date)::integer d, (count(distinct work_date) filter (where late_minutes > 0))::integer l,
           coalesce(sum(worked_seconds), 0)::bigint w
    from att group by employee_id
  ), pts as (
    select att.employee_id, att.id as att_id, lr.recorded_at, lr.geog,
           lag(lr.geog) over w as pg, lag(lr.recorded_at) over w as pt
    from att
    join public.location_records lr
      on lr.employee_id = att.employee_id and lr.company_id = p_company_id
     and lr.recorded_at >= att.check_in_at and lr.recorded_at <= att.end_at
    where not lr.is_mock and (lr.accuracy is null or lr.accuracy <= 100)
    window w as (partition by att.id order by lr.recorded_at)
  ), seg as (
    select employee_id, extract(epoch from (recorded_at - pt)) dt,
           extensions.st_distance(geog, pg) dist
    from pts where pt is not null
  ), seg_agg as (
    select employee_id,
           coalesce(sum(dt) filter (where dt > 0 and dt <= 1200), 0)::bigint tracked,
           coalesce(sum(dist) filter (where dt > 0 and dt <= 1200 and dist / dt <= 70), 0)::double precision dist
    from seg group by employee_id
  ), pt_count as (
    select employee_id, count(*)::bigint n from pts group by employee_id
  ), intr as (
    select ti.employee_id, count(*)::integer n,
           coalesce(sum(extract(epoch from (coalesce(ti.ended_at, least(now(), att.end_at)) - ti.started_at))), 0)::bigint secs
    from public.tracking_interruptions ti
    join public.tracking_sessions ts on ts.id = ti.tracking_session_id
    join att on att.id = ts.attendance_id
    group by ti.employee_id
  )
  select e.id, e.employee_code, e.full_name,
         coalesce(g.d, 0), coalesce(g.l, 0), coalesce(g.w, 0)::bigint,
         coalesce(s.tracked, 0)::bigint, coalesce(s.dist, 0)::double precision, coalesce(pc.n, 0)::bigint,
         coalesce(i.n, 0), coalesce(i.secs, 0)::bigint
  from public.employees e
  left join att_agg g on g.employee_id = e.id
  left join seg_agg s on s.employee_id = e.id
  left join pt_count pc on pc.employee_id = e.id
  left join intr i on i.employee_id = e.id
  where e.company_id = p_company_id and (e.is_active or g.d is not null)
  order by e.full_name;
end $$;

revoke execute on function public.productivity_report(uuid, date, date) from public, anon;
grant execute on function public.productivity_report(uuid, date, date) to authenticated, service_role;

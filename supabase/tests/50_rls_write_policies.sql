-- Per-command write policies (migration 009) and productivity_report scoping.
do $$
declare ca uuid := t.id('cA'); cb uuid := t.id('cB'); n bigint;
begin
  -- company admin A
  perform t.login(t.id('uAA'));
  perform t.ok(t.rows(format($q$insert into public.departments (company_id, name) values (%L, 'Ops')$q$, ca)) = 1, 'company admin can insert department in own company');
  perform t.throws(format($q$insert into public.departments (company_id, name) values (%L, 'X')$q$, cb), 'row-level security', 'company admin cannot insert department in another company');
  perform t.ok(t.rows($q$update public.departments set name = 'Operations' where name = 'Ops'$q$) = 1, 'company admin can update own department');
  perform t.ok(t.rows(format($q$insert into public.shifts (company_id, name, start_time, end_time) values (%L, 'Eve', '14:00', '22:00')$q$, ca)) = 1, 'company admin can insert shift');
  perform t.ok(t.rows(format($q$insert into public.system_settings (company_id, key, value) values (%L, 'live.stale_after_s', '120')$q$, ca)) = 1, 'company admin can write own company setting');
  perform t.throws($q$insert into public.system_settings (company_id, key, value) values (null, 'live.stale_after_s', '90')$q$, 'row-level security', 'company admin cannot write global setting');
  perform t.throws($q$insert into public.companies (code, name) values ('zzz', 'Zzz')$q$, 'row-level security', 'company admin cannot create company');
  perform t.ok(t.rows($q$update public.companies set name = 'Hacked'$q$) = 0, 'company admin cannot update companies');
  perform t.ok(t.rows($q$delete from public.departments where name = 'Operations'$q$) = 1, 'company admin can delete own department');
  perform t.logout();

  -- company admin B cannot touch A's rows
  perform t.login(t.id('uAB'));
  perform t.ok(t.rows($q$update public.shifts set name = 'Hijack'$q$) = 0, 'other company admin cannot update shifts of company A');
  perform t.ok(t.rows($q$delete from public.shifts$q$) = 0, 'other company admin cannot delete shifts of company A');
  perform t.ok(t.rows($q$update public.system_settings set value = '60' where company_id is null$q$) = 0, 'company admin cannot update global setting');
  perform t.logout();

  -- manager and employee
  perform t.login(t.id('uMA'));
  perform t.throws(format($q$insert into public.departments (company_id, name) values (%L, 'M')$q$, ca), 'row-level security', 'manager cannot insert department');
  perform t.ok(t.rows($q$delete from public.shifts$q$) = 0, 'manager cannot delete shifts');
  perform t.throws(format($q$insert into public.manager_assignments (company_id, manager_employee_id, employee_id) values (%L, %L, %L)$q$, ca, t.id('eMA'), t.id('eA2')), 'row-level security', 'manager cannot assign employees to themselves');
  perform t.logout();
  perform t.login(t.id('uA1'));
  perform t.throws(format($q$insert into public.geofences (company_id, name, type, latitude, longitude, radius_m) values (%L, 'g', 'office', 1, 1, 100)$q$, ca), 'row-level security', 'employee cannot create geofence');
  perform t.logout();

  -- super admin
  perform t.login(t.id('uSuper'));
  perform t.ok(t.rows($q$insert into public.companies (code, name) values ('newco', 'New Co')$q$) = 1, 'super admin can create company');
  perform t.ok(t.rows($q$delete from public.companies where code = 'newco'$q$) = 1, 'super admin can delete company');
  perform t.logout();

  -- exactly one policy per command (the point of the split)
  perform t.ok(not exists (
    select 1 from pg_policies p where p.schemaname = 'public' and p.tablename in ('companies','departments','geofences','shifts','manager_assignments','system_settings')
      and p.cmd = 'ALL'), 'no FOR ALL policies remain on split tables');
  perform t.ok(not exists (
    select 1 from (select tablename, cmd, count(*) c from pg_policies where schemaname = 'public' group by 1, 2) x where x.c > 1), 'no table has two permissive policies for the same command');

  -- productivity_report scoping and limits
  perform t.login(t.id('uMA'));
  perform t.ok((select array_agg(employee_id order by employee_id) from public.productivity_report(ca, '2026-09-01', '2026-11-30')) <@ array[t.id('eA1'), t.id('eMA')] and not exists (select 1 from public.productivity_report(ca, '2026-09-01', '2026-11-30') where employee_id = t.id('eA2')), 'productivity_report: manager sees only self and assigned employees');
  perform t.ok((select count(*) from public.productivity_report(cb, '2026-09-01', '2026-11-30')) = 0, 'productivity_report: manager gets no rows for another company');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.ok((select count(*) from public.productivity_report(ca, '2026-09-01', '2026-11-30')) = 0, 'productivity_report: other company admin gets no rows for company A');
  perform t.throws(format($q$select * from public.productivity_report(%L, '2026-01-01', '2027-12-31')$q$, cb), 'RANGE_TOO_LARGE', 'productivity_report rejects ranges over 92 days');
  perform t.throws(format($q$select * from public.productivity_report(%L, '2026-02-01', '2026-01-01')$q$, cb), 'INVALID_RANGE', 'productivity_report rejects inverted range');
  perform t.logout();
  perform t.login(t.id('uAA'));
  perform t.ok((select coalesce(sum(location_points), 0) from public.productivity_report(ca, '2026-09-01', '2026-11-30')) > 0, 'productivity_report: company admin sees tracked points');
  perform t.logout();
  execute 'set local role anon';
  perform t.throws(format($q$select * from public.productivity_report(%L, '2026-09-01', '2026-10-01')$q$, ca), 'permission denied', 'anon cannot run productivity_report');
  perform t.logout();
end $$;

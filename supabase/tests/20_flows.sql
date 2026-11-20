-- Seed two companies, then exercise check-in/out, ingest, RLS, settings, admin functions.
create table t.ids (k text primary key, v uuid); grant all on t.ids to public;
create table t.payload (k text primary key, v jsonb); grant all on t.payload to public;
create function t.id(k text) returns uuid language sql stable as $$ select v from t.ids where t.ids.k = $1 $$;
grant execute on function t.id(text) to public;

do $$
declare ca uuid; cb uuid; sh uuid; d uuid; e uuid; u uuid; r record;
begin
  insert into public.companies (code, name) values ('acme', 'Acme Pvt Ltd') returning id into ca;
  insert into public.companies (code, name) values ('beta', 'Beta Traders') returning id into cb;
  insert into t.ids values ('cA', ca), ('cB', cb);
  insert into public.shifts (company_id, name, start_time, end_time, grace_minutes, working_days)
    values (ca, 'Day', '09:00', '18:00', 10, '{1,2,3,4,5}') returning id into sh;
  insert into t.ids values ('shA', sh);
  for r in select * from (values
      ('A1','acme','empA1','Asha Rao','employee'), ('A2','acme','EmpA2','Bharat K','employee'),
      ('MA','acme','mgrA','Meena Manager','manager'), ('AA','acme','adminA','Arun Admin','company_admin'),
      ('B1','beta','empB1','Chitra B','employee'), ('AB','beta','adminB','Bala Admin','company_admin')) as x(k, c, code, nm, role) loop
    insert into public.employees (company_id, employee_code, full_name, shift_id)
      values ((select id from public.companies where code = r.c), r.code, r.nm, case when r.k = 'A1' then sh end) returning id into e;
    insert into auth.users (phone) select login_phone from public.employees where id = e returning id into u;
    update public.employees set user_id = u where id = e;
    insert into public.user_roles (user_id, company_id, role) values (u, (select id from public.companies where code = r.c), r.role::public.app_role);
    insert into t.ids values ('e' || r.k, e), ('u' || r.k, u);
  end loop;
  insert into auth.users (phone) values (null) returning id into u;
  insert into public.user_roles (user_id, company_id, role) values (u, null, 'super_admin');
  insert into t.ids values ('uSuper', u);
  insert into public.manager_assignments (company_id, manager_employee_id, employee_id)
    values (ca, t.id('eMA'), t.id('eA1'));
  perform t.ok((select count(*) from public.employees) = 6, 'seed: 6 employees in 2 companies');
  perform t.ok((select count(*) from public.audit_logs where entity_type = 'employees' and action = 'INSERT' and entity_id in (select id::text from public.employees)) = 6, 'audit log captures employee inserts');
end $$;

-- late calculation (deterministic): shift 09:00, grace 10, Mon-Fri, Asia/Kolkata
do $$
declare sh uuid := t.id('shA'); c uuid := t.id('cA');
begin
  perform t.ok(app.calc_late(c, sh, '2026-11-16 09:30:00+05:30') = 20, 'late: 09:30 on Monday = 20 min beyond grace');
  perform t.ok(app.calc_late(c, sh, '2026-11-16 09:05:00+05:30') = 0, 'late: within grace = 0');
  perform t.ok(app.calc_late(c, sh, '2026-11-22 09:30:00+05:30') = 0, 'late: non-working day (Sunday) = 0');
  perform t.ok(app.calc_late(c, null, now()) = 0, 'late: no shift = 0');
end $$;

-- ---------------------------------------------------------------- employee A1: device + check-in
do $$
declare d1 uuid; d2 uuid; a public.attendance; a2 public.attendance; ci timestamptz := now() - interval '180 minutes';
begin
  perform t.login(t.id('uA1'));
  d1 := public.register_device('device-A1-aaaa', 'Pixel 7', '15', '1.0.0', 'tok');
  d2 := public.register_device('device-A1-aaaa', 'Pixel 7', '15', '1.0.0', 'tok2');
  perform t.ok(d1 = d2, 'register_device is idempotent for the same device');
  perform t.throws($q$select public.register_device('device-A1-bbbb', 'Other', '14', '1.0.0', null)$q$, 'DEVICE_LIMIT_REACHED', 'second active device blocked by device limit');
  perform t.throws(format($q$select public.check_in(%L, %L, 'unknown-device', %L, 15.4589, 75.0078, 12)$q$, gen_random_uuid(), gen_random_uuid(), ci), 'DEVICE_NOT_REGISTERED', 'check-in from unregistered device rejected');
  perform t.throws(format($q$select public.check_in(%L, %L, 'device-A1-aaaa', %L, 15.4589, 75.0078, 12)$q$, gen_random_uuid(), gen_random_uuid(), now() + interval '1 hour'), 'TIMESTAMP_IN_FUTURE', 'future check-in timestamp rejected');
  perform t.throws(format($q$select public.check_in(%L, %L, 'device-A1-aaaa', %L, 15.4589, 75.0078, 900)$q$, gen_random_uuid(), gen_random_uuid(), ci), 'ACCURACY_TOO_LOW', 'check-in with poor GPS accuracy rejected');
  perform t.throws(format($q$select public.check_in(%L, %L, 'device-A1-aaaa', %L, 95, 75.0078, 12)$q$, gen_random_uuid(), gen_random_uuid(), ci), 'INVALID_COORDINATES', 'check-in with invalid latitude rejected');
  insert into t.ids values ('att1', gen_random_uuid()), ('sess1', gen_random_uuid());
  a := public.check_in(t.id('att1'), t.id('sess1'), 'device-A1-aaaa', ci, 15.4589, 75.0078, 12);
  perform t.ok(a.status = 'open' and a.check_in_at = ci, 'T1 check-in succeeds and preserves device timestamp');
  a2 := public.check_in(t.id('att1'), t.id('sess1'), 'device-A1-aaaa', ci, 15.4589, 75.0078, 12);
  perform t.ok(a2.id = a.id, 'check-in retry with same id is idempotent');
  perform t.throws(format($q$select public.check_in(%L, %L, 'device-A1-aaaa', %L, 15.4589, 75.0078, 12)$q$, gen_random_uuid(), gen_random_uuid(), ci + interval '1 minute'), 'DUPLICATE_CHECKIN', 'T12 duplicate check-in for an active shift rejected');
  perform t.ok((select is_checked_in from public.employee_live_status where employee_id = t.id('eA1')), 'live status shows checked-in');
  perform t.logout();
end $$;

-- ---------------------------------------------------------------- ingest
do $$
declare ci timestamptz; recs jsonb; res jsonb; res2 jsonb;
begin
  select check_in_at into ci from public.attendance where id = t.id('att1');
  select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'latitude', 15.4589 + i * 0.001, 'longitude', 75.0078,
        'accuracy', 10, 'speed', 1.2, 'bearing', 90, 'altitude', 560, 'battery_percentage', 80 - i, 'provider', 'fused',
        'network_status', 'wifi', 'recorded_at', ci + (i * 10 || ' minutes')::interval)) into recs from generate_series(1, 5) i;
  recs := recs || jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'latitude', 95, 'longitude', 75, 'recorded_at', ci + interval '70 minutes'),
    jsonb_build_object('id', gen_random_uuid(), 'latitude', 15.5, 'longitude', 75, 'accuracy', 10, 'recorded_at', now() + interval '2 hours'),
    jsonb_build_object('id', gen_random_uuid(), 'latitude', 15.5, 'longitude', 75, 'accuracy', 10, 'recorded_at', ci - interval '30 minutes'));
  insert into t.payload values ('batch1', recs);
  perform t.login(t.id('uA1'));
  res := public.ingest_locations(t.id('sess1'), recs);
  perform t.ok((res ->> 'accepted')::int = 5 and (res ->> 'duplicates')::int = 0 and jsonb_array_length(res -> 'rejected') = 3, 'T4 ingest: 5 accepted, 3 rejected, 0 duplicates', res::text);
  perform t.ok((select array_agg(x ->> 'reason' order by x ->> 'reason') from jsonb_array_elements(res -> 'rejected') x)
     = array['BEFORE_SESSION_START', 'INVALID_COORDINATES', 'TIMESTAMP_IN_FUTURE'], 'rejections carry explicit reasons (not silently dropped)');
  res2 := public.ingest_locations(t.id('sess1'), recs);
  perform t.ok((res2 ->> 'accepted')::int = 0 and (res2 ->> 'duplicates')::int = 5, 'T6 re-upload after reconnect: duplicates prevented', res2::text);
  perform t.throws(format($q$select public.ingest_locations(%L, '{"a":1}')$q$, t.id('sess1')), 'INVALID_PAYLOAD', 'non-array payload rejected');
  perform t.logout();
  perform t.ok((select min(recorded_at) from public.location_records where tracking_session_id = t.id('sess1')) = ci + interval '10 minutes', 'recorded_at preserved exactly (not replaced by sync time)');
  perform t.ok((select min(received_at - recorded_at) from public.location_records where tracking_session_id = t.id('sess1')) > interval '2 hours', 'received_at records server arrival separately from recorded_at');
  perform t.ok((select last_recorded_at from public.employee_live_status where employee_id = t.id('eA1')) = ci + interval '50 minutes', 'live status tracks newest recorded fix');
  perform t.ok((select freshness from public.employee_status_v where employee_id = t.id('eA1')) = 'offline', 'stale position (2h old) is NOT labelled live');
end $$;

-- ---------------------------------------------------------------- privileges + RLS write-denial
do $$
begin
  perform t.login(t.id('uA1'));
  perform t.throws($q$insert into public.attendance (id, company_id, employee_id, work_date, check_in_at, check_in_lat, check_in_lng, check_in_accuracy) select gen_random_uuid(), company_id, id, current_date, now(), 1, 1, 1 from public.employees limit 1$q$, 'permission denied', 'employee cannot INSERT attendance directly');
  perform t.throws($q$update public.attendance set late_minutes = 0$q$, 'permission denied', 'employee cannot UPDATE attendance directly');
  perform t.throws($q$delete from public.location_records$q$, 'permission denied', 'employee cannot DELETE GPS history');
  perform t.throws($q$update public.location_records set latitude = 0$q$, 'permission denied', 'employee cannot UPDATE GPS history');
  perform t.throws($q$insert into public.location_records (id, company_id, employee_id, tracking_session_id, latitude, longitude, recorded_at) select gen_random_uuid(), company_id, employee_id, tracking_session_id, 1, 1, now() from public.location_records limit 1$q$, 'permission denied', 'employee cannot INSERT GPS rows directly (only via ingest RPC)');
  perform t.throws($q$update public.employee_live_status set is_checked_in = false$q$, 'permission denied', 'employee cannot tamper with live status');
  perform t.throws($q$insert into public.user_roles (user_id, company_id, role) values (gen_random_uuid(), null, 'super_admin')$q$, 'permission denied', 'employee cannot grant roles');
  perform t.ok(t.rows($q$update public.employees set full_name = 'Hacked'$q$) = 0, 'employee cannot update employee records (RLS filters to 0 rows)');
  perform t.throws($q$select public.admin_correct_attendance(gen_random_uuid(), null, now(), 'trying to correct')$q$, 'ATTENDANCE_NOT_FOUND', 'unknown attendance id reported');
  perform t.logout();
  execute 'set local role anon';
  perform t.throws($q$select * from public.employees$q$, 'permission denied', 'anon cannot read employees');
  perform t.throws($q$select * from public.location_records$q$, 'permission denied', 'anon cannot read GPS data');
  perform t.throws($q$select public.get_tracking_config()$q$, 'permission denied', 'anon cannot call RPCs');
  perform t.logout();
end $$;

-- ---------------------------------------------------------------- other users check in
do $$
declare ci2 timestamptz := now() - interval '100 minutes'; recs jsonb;
begin
  perform t.login(t.id('uA2'));
  perform public.register_device('device-A2-aaaa', 'Galaxy', '14', '1.0.0', null);
  insert into t.ids values ('att2', gen_random_uuid()), ('sess2', gen_random_uuid());
  perform public.check_in(t.id('att2'), t.id('sess2'), 'device-A2-aaaa', ci2, 15.4000, 75.0000, 15);
  perform t.throws(format($q$select public.ingest_locations(%L, '[]')$q$, t.id('sess1')), 'SESSION_NOT_FOUND', 'employee cannot ingest into another employee''s session');
  select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'latitude', 15.4000 + i * 0.0001, 'longitude', 75.0000, 'accuracy', 12,
    'battery_percentage', 70, 'network_status', 'cellular', 'recorded_at', ci2 + (i * 5 || ' minutes')::interval)) into recs from generate_series(1, 3) i;
  perform public.ingest_locations(t.id('sess2'), recs);
  perform t.logout();

  perform t.login(t.id('uB1'));
  perform public.register_device('device-B1-aaaa', 'Moto', '13', '1.0.0', null);
  insert into t.ids values ('attB', gen_random_uuid()), ('sessB', gen_random_uuid());
  perform public.check_in(t.id('attB'), t.id('sessB'), 'device-B1-aaaa', now() - interval '90 minutes', 12.9716, 77.5946, 8);
  select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'latitude', 12.9716 + i * 0.0001, 'longitude', 77.5946, 'accuracy', 8,
    'recorded_at', now() - interval '80 minutes' + (i * 5 || ' minutes')::interval)) into recs from generate_series(1, 2) i;
  perform public.ingest_locations(t.id('sessB'), recs);
  perform t.logout();
  perform t.ok((select count(*) from public.employee_live_status where is_checked_in) = 3, 'T15 three employees tracking simultaneously');
end $$;

-- ---------------------------------------------------------------- check-out + immutability
do $$
declare a public.attendance; a2 public.attendance; ci timestamptz; co timestamptz := now() - interval '60 minutes'; res jsonb;
begin
  select check_in_at into ci from public.attendance where id = t.id('att1');
  perform t.login(t.id('uA1'));
  perform t.throws(format($q$select public.check_out(%L, %L, 15.5, 75.1, 10)$q$, t.id('att1'), ci - interval '1 minute'), 'CHECKOUT_BEFORE_CHECKIN', 'check-out before check-in rejected');
  a := public.check_out(t.id('att1'), co, 15.4640, 75.0078, 11);
  perform t.ok(a.status = 'closed' and a.worked_seconds = 7200 and a.finalized_at is not null, 'T11 check-out finalizes attendance (worked 7200 s)');
  a2 := public.check_out(t.id('att1'), co + interval '5 minutes', 1, 1, 1);
  perform t.ok(a2.check_out_at = co, 'check-out retry is idempotent and keeps original time');
  perform t.ok((select status from public.tracking_sessions where id = t.id('sess1')) = 'ended', 'check-out ends the tracking session');
  perform t.ok(not (select is_checked_in from public.employee_live_status where employee_id = t.id('eA1')), 'live status cleared after check-out');
  res := public.ingest_locations(t.id('sess1'), jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'latitude', 15.46, 'longitude', 75.0078, 'accuracy', 9, 'recorded_at', co - interval '5 minutes'),
    jsonb_build_object('id', gen_random_uuid(), 'latitude', 15.46, 'longitude', 75.0078, 'accuracy', 9, 'recorded_at', co + interval '30 minutes')));
  perform t.ok((res ->> 'accepted')::int = 1 and res -> 'rejected' -> 0 ->> 'reason' = 'AFTER_SESSION_END',
     'offline fix recorded before check-out accepted; fix after check-out rejected (no tracking after check-out)', res::text);
  perform t.throws(format($q$select public.check_in(%L, %L, 'device-A1-aaaa', %L, 15.4, 75.0, 10)$q$, gen_random_uuid(), gen_random_uuid(), co - interval '10 minutes'), 'OVERLAPPING_ATTENDANCE', 'new check-in overlapping a finished shift rejected');
  insert into t.ids values ('att3', gen_random_uuid()), ('sess3', gen_random_uuid());
  perform public.check_in(t.id('att3'), t.id('sess3'), 'device-A1-aaaa', now() - interval '30 minutes', 15.4589, 75.0078, 12);
  perform t.ok(true, 'new shift allowed after check-out');
  perform t.logout();
  perform t.throws(format($q$update public.attendance set late_minutes = 5 where id = %L$q$, t.id('att1')), 'IMMUTABLE_RECORD', 'finalized attendance blocked from modification even for privileged roles');
  perform t.throws($q$delete from public.attendance$q$, 'IMMUTABLE_RECORD', 'attendance cannot be deleted');
  perform t.throws($q$update public.location_records set latitude = 0$q$, 'IMMUTABLE_RECORD', 'GPS history is immutable');
  perform t.throws($q$delete from public.audit_logs$q$, 'IMMUTABLE_RECORD', 'audit log is append-only');
end $$;

-- ---------------------------------------------------------------- tenant isolation / visibility
do $$
declare ca uuid := t.id('cA');
begin
  perform t.login(t.id('uAA'));
  perform t.ok((select count(*) from public.attendance) = 3 and (select count(*) from public.attendance where company_id <> ca) = 0, 'T16 company admin A sees only company A attendance (3 rows)');
  perform t.ok((select count(*) from public.location_records where company_id <> ca) = 0 and (select count(*) from public.location_records) > 0, 'company admin A sees A GPS rows, none of B');
  perform t.ok((select count(*) from public.employees) = 4, 'company admin A sees 4 company A employees');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.ok((select count(*) from public.attendance) = 1 and (select count(*) from public.employees where company_id = ca) = 0, 'T16 company admin B cannot see any company A data');
  perform t.ok(t.rows(format($q$update public.employees set is_active = false where id = %L$q$, t.id('eA1'))) = 0, 'cross-tenant UPDATE affects 0 rows');
  perform t.throws(format($q$insert into public.departments (company_id, name) values (%L, 'Sneaky')$q$, ca), 'row-level security', 'cross-tenant INSERT blocked by RLS');
  perform t.ok((select count(*) from public.audit_logs where company_id = ca) = 0, 'admin B cannot read company A audit log');
  perform t.throws('select * from public.geofence_state', 'permission denied', 'geofence_state not readable');
  perform t.logout();
  perform t.login(t.id('uA2'));
  perform t.ok((select count(distinct employee_id) from public.attendance) = 1 and (select count(distinct employee_id) from public.location_records) = 1, 'employee sees only own attendance and GPS history');
  perform t.ok((select count(*) from public.employees) = 1, 'employee sees only own employee record');
  perform t.logout();
  perform t.login(t.id('uMA'));
  perform t.ok((select array_agg(distinct employee_id) from public.attendance) = array[t.id('eA1')], 'manager sees only assigned employee (A1), not A2');
  perform t.ok((select count(*) from public.location_records where employee_id = t.id('eA2')) = 0, 'manager cannot read unassigned employee GPS');
  perform t.logout();
  perform t.login(t.id('uSuper'));
  perform t.ok((select count(*) from public.attendance) = 4, 'super admin sees all companies (4 attendance rows)');
  perform t.logout();
  perform t.login(t.id('uAA'));
  perform t.throws(format($q$update public.employees set company_id = %L where id = %L$q$, t.id('cB'), t.id('eA2')), 'PROTECTED_COLUMN', 'admin cannot move an employee to another company');
  perform t.ok(t.rows(format($q$update public.employees set full_name = 'Bharat Kumar' where id = %L$q$, t.id('eA2'))) = 1, 'company admin can update own employees');
  perform t.ok((select count(*) from public.audit_logs where entity_type = 'employees' and action = 'UPDATE' and actor_user_id = t.id('uAA')) = 1, 'admin edit is audit-logged with actor');
  perform t.throws($q$insert into public.user_roles (user_id, company_id, role) values (gen_random_uuid(), null, 'super_admin')$q$, 'permission denied', 'company admin cannot create roles');
  perform t.logout();
end $$;

-- ---------------------------------------------------------------- settings + tracking config
do $$
begin
  perform t.login(t.id('uAA'));
  perform t.throws(format($q$insert into public.system_settings (company_id, key, value) values (%L, 'tracking.moving_interval_s', '1')$q$, t.id('cA')), 'SETTING_OUT_OF_RANGE', 'setting below minimum rejected');
  perform t.throws(format($q$insert into public.system_settings (company_id, key, value) values (%L, 'bogus.key', '1')$q$, t.id('cA')), 'UNKNOWN_SETTING', 'unknown setting key rejected');
  perform t.throws(format($q$insert into public.system_settings (company_id, key, value) values (%L, 'tracking.moving_interval_s', '"fast"')$q$, t.id('cA')), 'SETTING_OUT_OF_RANGE', 'non-numeric setting rejected');
  perform t.throws($q$insert into public.system_settings (company_id, key, value) values (null, 'tracking.moving_interval_s', '45')$q$, 'row-level security', 'company admin cannot change global defaults');
  perform t.ok(t.rows(format($q$insert into public.system_settings (company_id, key, value) values (%L, 'tracking.moving_interval_s', '45')$q$, t.id('cA'))) = 1, 'company admin sets GPS interval for own company');
  perform t.logout();
  perform t.login(t.id('uA2'));
  perform t.ok((public.get_tracking_config() -> 'settings' ->> 'tracking.moving_interval_s')::int = 45, 'employee app receives company-specific GPS interval (45 s)');
  perform t.logout();
  perform t.login(t.id('uB1'));
  perform t.ok((public.get_tracking_config() -> 'settings' ->> 'tracking.moving_interval_s')::int = 30, 'other company still gets default (30 s)');
  perform t.ok((select count(*) from public.system_settings where company_id = t.id('cA')) = 0, 'company B cannot see company A settings');
  perform t.logout();
end $$;

-- ---------------------------------------------------------------- login mapping + admin functions
do $$
declare ph text; a public.attendance;
begin
  perform t.login(t.id('uA1'));
  perform t.throws($q$select public.resolve_employee_login('acme', 'empA1')$q$, 'permission denied', 'clients cannot resolve Employee ID to login phone');
  perform t.logout();
  perform t.service();
  ph := public.resolve_employee_login(' ACME ', 'empa1');
  perform t.ok(ph = (select login_phone from public.employees where id = t.id('eA1')) and ph ~ '^\+999[0-9]{11}$', 'service_role resolves company code + Employee ID (case-insensitive) to internal phone');
  perform t.ok(public.resolve_employee_login('acme', 'nobody') is null and public.resolve_employee_login('nope', 'empA1') is null, 'unknown employee/company resolves to NULL');
  perform t.logout();
  update public.employees set is_active = false where id = t.id('eB1');
  perform t.ok(public.resolve_employee_login('beta', 'empB1') is null, 'deactivated employee cannot be resolved for login');
  update public.employees set is_active = true where id = t.id('eB1');

  perform t.login(t.id('uAA'));
  perform t.throws(format($q$select public.admin_correct_attendance(%L, null, %L, 'x')$q$, t.id('att1'), now() - interval '50 minutes'), 'REASON_REQUIRED', 'correction requires a reason');
  a := public.admin_correct_attendance(t.id('att1'), null, now() - interval '50 minutes', 'Employee forgot to check out on time');
  perform t.ok(a.worked_seconds = 7800 and a.corrected_by = t.id('uAA') and a.correction_reason is not null, 'admin correction updates hours and records who/why');
  perform t.ok((select count(*) from public.audit_logs where action = 'CORRECT_ATTENDANCE' and entity_id = t.id('att1')::text) = 1, 'correction audit entry contains old and new values');
  perform public.log_admin_access('route_history', t.id('eA1'), '{"date":"2026-11-20"}');
  perform t.ok((select count(*) from public.audit_logs where action = 'VIEW_ROUTE_HISTORY') = 1, 'admin access to route history is logged');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.throws(format($q$select public.admin_correct_attendance(%L, null, %L, 'cross tenant attempt')$q$, t.id('att1'), now() - interval '40 minutes'), 'FORBIDDEN', 'admin of another company cannot correct attendance');
  perform t.throws(format($q$select public.log_admin_access('live_location', %L)$q$, t.id('eA1')), 'FORBIDDEN', 'admin of another company cannot log/view access to A1');
  perform t.logout();
  perform t.login(t.id('uMA'));
  perform t.throws(format($q$select public.log_admin_access('live_location', %L)$q$, t.id('eA2')), 'FORBIDDEN', 'manager cannot view unassigned employee');
  perform t.logout();
  perform t.login(t.id('uA1'));
  perform t.throws(format($q$select public.admin_correct_attendance(%L, null, %L, 'self correction')$q$, t.id('att1'), now() - interval '40 minutes'), 'FORBIDDEN', 'employee cannot correct own attendance');
  perform t.logout();
end $$;

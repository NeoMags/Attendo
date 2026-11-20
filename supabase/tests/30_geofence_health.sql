-- Geofencing, device health, interruptions, live-status freshness, partitions/retention.

-- ---------------------------------------------------------------- geofencing (employee A2, session sess2)
do $$
declare gid uuid; base timestamptz := now() - interval '80 minutes'; recs jsonb; ev record; n int;
  c_lat constant float8 := 15.4600; c_lng constant float8 := 75.0100;
begin
  perform t.login(t.id('uAA'));
  insert into public.geofences (company_id, name, type, latitude, longitude, radius_m, hysteresis_fixes)
    values (t.id('cA'), 'Head Office', 'office', c_lat, c_lng, 100, 2) returning id into gid;
  insert into t.ids values ('gf1', gid);
  perform t.throws(format($q$insert into public.geofences (company_id, name, type, latitude, longitude, radius_m) values (%L, 'Tiny', 'branch', 1, 1, 2)$q$, t.id('cA')), 'violates check', 'geofence radius below 10 m rejected');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.ok((select count(*) from public.geofences) = 0, 'company B cannot see company A geofences');
  perform t.ok(t.rows(format($q$update public.geofences set radius_m = 5000 where id = %L$q$, gid)) = 0, 'company B cannot modify company A geofences');
  perform t.logout();

  -- f1 far(out) | f2,f3 centre(in,in => ENTER) | f4 boundary acc 30 (ambiguous) | f5,f6 far(out,out => EXIT)
  -- f7 centre (in, streak 1) | f8 far (out agrees with state => reset, no ENTER) | f9 centre acc NULL (ignored) | f10 centre (streak 1 only)
  select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'latitude', v.lat, 'longitude', c_lng, 'accuracy', v.acc,
        'recorded_at', base + (v.i * 3 || ' minutes')::interval) order by v.i) into recs
  from (values (1, c_lat + 0.0045, 10), (2, c_lat, 10), (3, c_lat, 10), (4, c_lat + 0.0009, 30), (5, c_lat + 0.0045, 10),
               (6, c_lat + 0.0045, 10), (7, c_lat, 10), (8, c_lat + 0.0045, 10), (9, c_lat, null), (10, c_lat, 10)) v(i, lat, acc);
  perform t.login(t.id('uA2'));
  perform public.ingest_locations(t.id('sess2'), recs);
  perform t.logout();
  select count(*) into n from public.geofence_events where employee_id = t.id('eA2');
  perform t.ok(n = 2, 'T13 geofence: exactly one ENTER and one EXIT despite boundary noise', 'events=' || n);
  select * into ev from public.geofence_events where employee_id = t.id('eA2') and event_type = 'enter';
  perform t.ok(ev.fixes_used = 2 and ev.occurred_at = base + interval '6 minutes' and ev.confirmed_at = base + interval '9 minutes',
    'ENTER uses recorded fix times (first certain fix = 6 min, confirmed by 2nd fix at 9 min)');
  select * into ev from public.geofence_events where employee_id = t.id('eA2') and event_type = 'exit';
  perform t.ok(ev.occurred_at = base + interval '15 minutes', 'EXIT occurs at first certain-outside fix of the confirming streak');
  perform t.ok((select count(*) from public.geofence_events where employee_id = t.id('eA2') and event_type = 'enter') = 1,
    'single in-fix, ambiguous fix and unknown-accuracy fix never create events');
  perform t.login(t.id('uA2'));
  perform t.ok((select count(*) from public.geofence_events) = 2, 'employee can read own geofence events');
  perform t.throws('delete from public.geofence_events', 'permission denied', 'employee cannot delete geofence events');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.ok((select count(*) from public.geofence_events) = 0, 'company B cannot read company A geofence events');
  perform t.logout();
end $$;

-- ---------------------------------------------------------------- health classification (pure)
do $$
declare h record; ca uuid := t.id('cA');
begin
  select * into h from app.derive_health(ca, 80::smallint, false, false, 'fine', true, true, true, 'wifi', 0, false, 0, true, true);
  perform t.ok(h.status = 'healthy' and cardinality(h.reasons) = 0, 'health: all good => healthy');
  select * into h from app.derive_health(ca, 80::smallint, false, false, 'fine', false, true, true, 'wifi', 0, false, 0, true, true);
  perform t.ok(h.status = 'interrupted' and 'location_services_off' = any (h.reasons), 'health: GPS off during session => interrupted');
  select * into h from app.derive_health(ca, 80::smallint, false, false, 'fine', false, true, true, 'wifi', 0, false, 0, true, false);
  perform t.ok(h.status = 'healthy', 'health: GPS off while NOT tracking is not an interruption');
  select * into h from app.derive_health(ca, 80::smallint, false, false, 'denied', true, true, true, 'wifi', 0, false, 0, true, true);
  perform t.ok(h.status = 'interrupted' and 'location_permission_missing' = any (h.reasons), 'T8 permission revoked => interrupted');
  select * into h from app.derive_health(ca, 80::smallint, false, false, 'fine', true, true, true, 'wifi', 0, false, 0, false, true);
  perform t.ok(h.status = 'interrupted' and 'tracking_service_not_running' = any (h.reasons), 'T9 foreground service dead => interrupted');
  select * into h from app.derive_health(ca, 10::smallint, false, false, 'fine', true, true, true, 'wifi', 0, false, 0, true, true);
  perform t.ok(h.status = 'degraded' and 'low_battery' = any (h.reasons), 'health: 10% battery => degraded');
  select * into h from app.derive_health(ca, 10::smallint, true, false, 'fine', true, true, true, 'wifi', 0, false, 0, true, true);
  perform t.ok(h.status = 'healthy', 'health: low battery but charging => healthy');
  select * into h from app.derive_health(ca, 80::smallint, false, true, 'coarse', true, false, false, 'none', 9999, true, 400, true, true);
  perform t.ok(h.status = 'degraded' and h.reasons @> array['power_save_mode','coarse_location_only','notifications_disabled','battery_optimization_active','no_network','sync_backlog','mock_location','clock_drift'],
    'health: all degradation reasons reported', array_to_string(h.reasons, ','));
  insert into public.system_settings (company_id, key, value) values (ca, 'health.low_battery_pct', '5');
  select * into h from app.derive_health(ca, 10::smallint, false, false, 'fine', true, true, true, 'wifi', 0, false, 0, true, true);
  perform t.ok(h.status = 'healthy', 'health thresholds are configurable per company');
  delete from public.system_settings where company_id = ca and key = 'health.low_battery_pct';
end $$;

-- ---------------------------------------------------------------- heartbeat RPC + interruptions
do $$
declare res jsonb; cap timestamptz := now(); iid uuid := gen_random_uuid(); hb jsonb;
begin
  hb := jsonb_build_object('device_uid', 'device-A2-aaaa', 'captured_at', cap, 'battery_percentage', 55, 'is_charging', false,
    'location_permission', 'fine', 'location_services_enabled', false, 'network_type', 'wifi', 'queue_pending', 3,
    'foreground_service_alive', true, 'app_version', '1.0.1', 'is_realtime', true);
  perform t.login(t.id('uA2'));
  res := public.record_heartbeat(hb);
  perform t.ok(res ->> 'status' = 'interrupted' and res -> 'reasons' ? 'location_services_off', 'T7 heartbeat with GPS disabled => interrupted (reported to server)', res::text);
  perform public.record_heartbeat(hb);
  perform t.ok((select count(*) from public.device_health_snapshots where employee_id = t.id('eA2')) = 1, 'duplicate heartbeat (same captured_at) stored once');
  perform t.ok((select clock_drift_seconds from public.device_health_snapshots where employee_id = t.id('eA2')) between -2 and 2, 'real-time heartbeat records server-measured clock drift');
  res := public.record_heartbeat(hb || jsonb_build_object('captured_at', cap - interval '1 hour', 'is_realtime', false, 'location_services_enabled', true));
  perform t.ok(res ->> 'status' = 'healthy' and (select clock_drift_seconds from public.device_health_snapshots where captured_at = cap - interval '1 hour') is null, 'queued (non-realtime) heartbeat does not produce false clock-drift');
  perform t.throws(format($q$select public.record_heartbeat(%L::jsonb)$q$, (hb || '{"device_uid":"nope-nope-nope"}')::text), 'DEVICE_NOT_REGISTERED', 'heartbeat from unregistered device rejected');
  perform public.record_heartbeat(hb || jsonb_build_object('captured_at', cap + interval '1 second'));
  perform public.report_interruption(iid, t.id('sess2'), now() - interval '20 minutes', null, 'gps_disabled', 'GPS switched off');
  perform public.report_interruption(iid, t.id('sess2'), now() - interval '20 minutes', now() - interval '15 minutes', 'gps_disabled', 'GPS switched off');
  perform t.ok((select count(*) from public.tracking_interruptions where id = iid and ended_at is not null) = 1, 'interruption reported then closed (idempotent upsert by id)');
  perform t.throws(format($q$select public.report_interruption(gen_random_uuid(), %L, now(), null, 'gps_disabled', null)$q$, t.id('sess1')), 'SESSION_NOT_FOUND', 'cannot report interruption on another employee''s session');
  perform t.throws(format($q$select public.report_interruption(gen_random_uuid(), %L, now(), null, 'bogus', null)$q$, t.id('sess2')), 'invalid input value for enum', 'unknown interruption reason rejected');
  perform t.logout();
  perform t.ok((select health_status::text from public.employee_live_status where employee_id = t.id('eA2')) = 'interrupted', 'live status carries latest health status');
  perform t.ok((select last_heartbeat_at from public.employee_live_status where employee_id = t.id('eA2')) > now() - interval '1 minute', 'heartbeat freshness uses server receipt time');
  perform t.login(t.id('uAA'));
  perform t.ok((select count(*) from public.device_health_snapshots) >= 1 and (select count(*) from public.tracking_interruptions) = 1, 'company admin can read health snapshots and interruptions');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.ok((select count(*) from public.device_health_snapshots) = 0 and (select count(*) from public.tracking_interruptions) = 0, 'company B cannot read company A health data');
  perform t.logout();
end $$;

-- ---------------------------------------------------------------- live status freshness labels
do $$
declare lbl text;
begin
  update public.employee_live_status set is_checked_in = true, last_recorded_at = now() - interval '1 minute' where employee_id = t.id('eA2');
  perform t.ok((select freshness from public.employee_status_v where employee_id = t.id('eA2')) = 'live', 'freshness: fix 1 min old => live');
  update public.employee_live_status set last_recorded_at = now() - interval '6 minutes' where employee_id = t.id('eA2');
  perform t.ok((select freshness from public.employee_status_v where employee_id = t.id('eA2')) = 'stale', 'freshness: fix 6 min old => stale');
  update public.employee_live_status set last_recorded_at = now() - interval '20 minutes' where employee_id = t.id('eA2');
  perform t.ok((select freshness from public.employee_status_v where employee_id = t.id('eA2')) = 'offline', 'freshness: fix 20 min old => offline');
  update public.employee_live_status set is_checked_in = false where employee_id = t.id('eA2');
  perform t.ok((select freshness from public.employee_status_v where employee_id = t.id('eA2')) = 'not_tracking', 'freshness: checked out => not_tracking');
  perform t.login(t.id('uAA'));
  perform t.ok((select count(distinct company_id) from public.employee_status_v) = 1, 'status view respects RLS (admin A sees only company A)');
  perform t.logout();
end $$;

-- ---------------------------------------------------------------- partitions + retention
do $$
declare r jsonb;
begin
  perform t.ok((select count(*) from public.location_records_default) = 0, 'no GPS rows fell into the default partition');
  perform t.ok(app.ensure_location_partitions(1, 3) = 0, 'ensure_location_partitions is idempotent');
  perform t.ok((select count(distinct tableoid::regclass::text) from public.location_records where tableoid::regclass::text like 'location_records_y%') >= 1, 'GPS rows stored in monthly partitions');
  create table public.location_records_y2019m01 partition of public.location_records for values from ('2019-01-01 00:00:00+00') to ('2019-02-01 00:00:00+00');
  r := app.purge_expired();
  perform t.ok((r ->> 'partitions_dropped')::int >= 1 and to_regclass('public.location_records_y2019m01') is null, 'retention drops expired monthly partition', r::text);
  perform t.ok((select count(*) from public.location_records) > 0, 'retention keeps in-window GPS data');
end $$;

-- ---------------------------------------------------------------- employee history views (own data only)
do $$
begin
  perform t.login(t.id('uA1'));
  perform t.ok((select count(*) from public.attendance) = 2 and (select count(distinct employee_id) from public.tracking_sessions) = 1, 'employee A1 sees own attendance history (2 shifts) and sessions');
  perform t.ok((select count(*) from public.location_records where employee_id <> t.id('eA1')) = 0, 'employee A1 cannot see colleagues'' routes');
  perform t.ok((select count(*) from public.audit_logs) = 0, 'employees cannot read audit logs');
  perform t.logout();
end $$;

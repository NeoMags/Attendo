-- Attendo 004: client-facing RPCs. All identity is derived from auth.uid(); clients never supply
-- company_id/employee_id. Errors use stable message prefixes (e.g. DUPLICATE_CHECKIN) for the apps.

create function app.require_employee() returns public.employees
language plpgsql stable security definer set search_path = '' as $$
declare e public.employees;
begin
  select * into e from public.employees where user_id = (select auth.uid()) and is_active;
  if not found then raise exception 'EMPLOYEE_NOT_FOUND' using errcode = '28000'; end if;
  if not exists (select 1 from public.companies c where c.id = e.company_id and c.is_active) then
    raise exception 'COMPANY_INACTIVE' using errcode = '28000';
  end if;
  return e;
end $$;

-- Minutes late beyond the shift grace period (company-local time). Overnight shifts are not supported.
create function app.calc_late(p_company uuid, p_shift uuid, p_ts timestamptz) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare s public.shifts; tz text; lt timestamp;
begin
  if p_shift is null then return 0; end if;
  select * into s from public.shifts where id = p_shift and company_id = p_company;
  if not found then return 0; end if;
  select timezone into tz from public.companies where id = p_company;
  lt := p_ts at time zone tz;
  if not (extract(isodow from lt)::smallint = any (s.working_days)) then return 0; end if;
  return greatest(0, floor(extract(epoch from (lt::time - s.start_time)) / 60)::integer - s.grace_minutes);
end $$;

-- Pure health classification. 'offline' is derived at read time from heartbeat age (employee_status_v).
create function app.derive_health(
  p_company uuid, p_battery smallint, p_charging boolean, p_power_save boolean, p_loc_perm text,
  p_loc_enabled boolean, p_notif boolean, p_bat_exempt boolean, p_network text, p_queue integer,
  p_mock boolean, p_drift integer, p_fg_alive boolean, p_session_active boolean,
  out status public.health_status, out reasons text[])
language plpgsql stable security definer set search_path = '' as $$
declare r text[] := '{}'; d text[] := '{}';
begin
  if p_session_active then
    if p_loc_enabled is false then r := array_append(r, 'location_services_off'::text); end if;
    if p_loc_perm in ('denied', 'not_requested') then r := array_append(r, 'location_permission_missing'::text); end if;
    if p_fg_alive is false then r := array_append(r, 'tracking_service_not_running'::text); end if;
  end if;
  if p_battery is not null and p_battery < app.setting_num(p_company, 'health.low_battery_pct') and p_charging is not true then
    d := array_append(d, 'low_battery'::text); end if;
  if p_power_save is true then d := array_append(d, 'power_save_mode'::text); end if;
  if p_bat_exempt is false then d := array_append(d, 'battery_optimization_active'::text); end if;
  if p_loc_perm = 'coarse' then d := array_append(d, 'coarse_location_only'::text); end if;
  if p_notif is false then d := array_append(d, 'notifications_disabled'::text); end if;
  if p_network = 'none' then d := array_append(d, 'no_network'::text); end if;
  if p_queue is not null and p_queue > app.setting_num(p_company, 'health.max_queue_pending') then d := array_append(d, 'sync_backlog'::text); end if;
  if p_mock is true then d := array_append(d, 'mock_location'::text); end if;
  if p_drift is not null and abs(p_drift) > app.setting_num(p_company, 'health.max_clock_drift_s') then d := array_append(d, 'clock_drift'::text); end if;
  reasons := r || d;
  status := case when cardinality(r) > 0 then 'interrupted' when cardinality(d) > 0 then 'degraded' else 'healthy' end;
end $$;

create function public.register_device(p_device_uid text, p_model text, p_os_version text,
  p_app_version text, p_fcm_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare e public.employees := app.require_employee(); d public.employee_devices; v_max integer; v_id uuid;
begin
  select * into d from public.employee_devices where employee_id = e.id and device_uid = p_device_uid;
  if found then
    if not d.is_active then raise exception 'DEVICE_BLOCKED'; end if;
    update public.employee_devices set model = coalesce(p_model, model), os_version = coalesce(p_os_version, os_version),
      app_version = coalesce(p_app_version, app_version), fcm_token = coalesce(p_fcm_token, fcm_token), last_seen_at = now()
      where id = d.id;
    return d.id;
  end if;
  v_max := app.setting_num(e.company_id, 'devices.max_active_per_employee')::integer;
  if (select count(*) from public.employee_devices where employee_id = e.id and is_active) >= v_max then
    raise exception 'DEVICE_LIMIT_REACHED';
  end if;
  insert into public.employee_devices (company_id, employee_id, device_uid, model, os_version, app_version, fcm_token, last_seen_at)
    values (e.company_id, e.id, p_device_uid, p_model, p_os_version, p_app_version, p_fcm_token, now()) returning id into v_id;
  return v_id;
end $$;

create function public.check_in(p_attendance_id uuid, p_session_id uuid, p_device_uid text,
  p_recorded_at timestamptz, p_lat double precision, p_lng double precision, p_accuracy real)
returns public.attendance language plpgsql security definer set search_path = '' as $$
declare e public.employees := app.require_employee(); a public.attendance; v_dev uuid; tz text; v_skew integer; v_last timestamptz;
begin
  select * into a from public.attendance where id = p_attendance_id;
  if found then                                            -- retry of an already-saved check-in
    if a.employee_id <> e.id then raise exception 'FORBIDDEN'; end if;
    return a;
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'INVALID_COORDINATES'; end if;
  if p_accuracy is null or p_accuracy < 0 then raise exception 'ACCURACY_REQUIRED'; end if;
  if p_accuracy > app.setting_num(e.company_id, 'checkin.max_accuracy_m') then
    raise exception 'ACCURACY_TOO_LOW: % m (limit % m)', round(p_accuracy), app.setting_num(e.company_id, 'checkin.max_accuracy_m'); end if;
  v_skew := app.setting_num(e.company_id, 'ingest.max_future_skew_s')::integer;
  if p_recorded_at is null or p_recorded_at > now() + make_interval(secs => v_skew) then raise exception 'TIMESTAMP_IN_FUTURE'; end if;
  if p_recorded_at < now() - interval '36 hours' then raise exception 'TIMESTAMP_TOO_OLD'; end if;
  if exists (select 1 from public.attendance where employee_id = e.id and status = 'open') then
    raise exception 'DUPLICATE_CHECKIN: an open shift already exists'; end if;
  select max(check_out_at) into v_last from public.attendance where employee_id = e.id;
  if v_last is not null and p_recorded_at <= v_last then raise exception 'OVERLAPPING_ATTENDANCE'; end if;
  select id into v_dev from public.employee_devices where employee_id = e.id and device_uid = p_device_uid and is_active;
  if v_dev is null then raise exception 'DEVICE_NOT_REGISTERED'; end if;
  select timezone into tz from public.companies where id = e.company_id;

  insert into public.attendance (id, company_id, employee_id, work_date, check_in_at, check_in_lat, check_in_lng,
                                 check_in_accuracy, late_minutes, device_id)
    values (p_attendance_id, e.company_id, e.id, (p_recorded_at at time zone tz)::date, p_recorded_at, p_lat, p_lng,
            p_accuracy, app.calc_late(e.company_id, e.shift_id, p_recorded_at), v_dev)
    returning * into a;
  insert into public.tracking_sessions (id, company_id, employee_id, attendance_id, started_at, device_id, config_snapshot)
    values (p_session_id, e.company_id, e.id, a.id, p_recorded_at, v_dev,
            jsonb_build_object('moving_s', app.setting_num(e.company_id, 'tracking.moving_interval_s'),
                               'stationary_s', app.setting_num(e.company_id, 'tracking.stationary_interval_s'),
                               'batch', app.setting_num(e.company_id, 'tracking.upload_batch_size')));
  insert into public.employee_live_status (employee_id, company_id, is_checked_in, attendance_id, tracking_session_id, checked_in_at)
    values (e.id, e.company_id, true, a.id, p_session_id, p_recorded_at)
    on conflict (employee_id) do update set is_checked_in = true, attendance_id = excluded.attendance_id,
      tracking_session_id = excluded.tracking_session_id, checked_in_at = excluded.checked_in_at,
      last_lat = null, last_lng = null, last_accuracy = null, last_battery = null,
      last_recorded_at = null, last_received_at = null, updated_at = now();
  return a;
end $$;

create function public.check_out(p_attendance_id uuid, p_recorded_at timestamptz,
  p_lat double precision, p_lng double precision, p_accuracy real)
returns public.attendance language plpgsql security definer set search_path = '' as $$
declare e public.employees := app.require_employee(); a public.attendance; v_skew integer;
begin
  select * into a from public.attendance where id = p_attendance_id and employee_id = e.id for update;
  if not found then raise exception 'ATTENDANCE_NOT_FOUND'; end if;
  if a.status = 'closed' then return a; end if;            -- idempotent retry
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng is null or p_lng not between -180 and 180) then
    raise exception 'INVALID_COORDINATES'; end if;
  v_skew := app.setting_num(e.company_id, 'ingest.max_future_skew_s')::integer;
  if p_recorded_at is null or p_recorded_at > now() + make_interval(secs => v_skew) then raise exception 'TIMESTAMP_IN_FUTURE'; end if;
  if p_recorded_at <= a.check_in_at then raise exception 'CHECKOUT_BEFORE_CHECKIN'; end if;
  update public.attendance set status = 'closed', check_out_at = p_recorded_at, check_out_received_at = now(),
    check_out_lat = p_lat, check_out_lng = p_lng, check_out_accuracy = p_accuracy,
    worked_seconds = floor(extract(epoch from (p_recorded_at - check_in_at)))::integer, finalized_at = now()
    where id = a.id returning * into a;
  update public.tracking_sessions set status = 'ended', ended_at = p_recorded_at, end_reason = 'check_out'
    where attendance_id = a.id and ended_at is null;
  update public.employee_live_status set is_checked_in = false, tracking_session_id = null, updated_at = now()
    where employee_id = e.id and attendance_id = a.id;
  delete from public.geofence_state where employee_id = e.id;
  return a;
end $$;

-- Batch ingest. Idempotent on (id, recorded_at). Every record is accepted, counted as a duplicate,
-- or returned in `rejected` with a reason; nothing is silently dropped. recorded_at is preserved.
create function public.ingest_locations(p_session_id uuid, p_records jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.employees := app.require_employee(); s public.tracking_sessions;
  v_total integer; v_max integer; v_skew integer; v_rejected jsonb; v_inserted jsonb; v_accepted integer; r record;
begin
  select * into s from public.tracking_sessions where id = p_session_id and employee_id = e.id;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if p_records is null or jsonb_typeof(p_records) <> 'array' then raise exception 'INVALID_PAYLOAD'; end if;
  v_total := jsonb_array_length(p_records);
  v_max := app.setting_num(e.company_id, 'ingest.max_batch_size')::integer;
  if v_total > v_max then raise exception 'BATCH_TOO_LARGE: % > %', v_total, v_max; end if;
  v_skew := app.setting_num(e.company_id, 'ingest.max_future_skew_s')::integer;

  with parsed as (
    select * from jsonb_to_recordset(p_records) as x(id uuid, latitude float8, longitude float8, accuracy real,
      speed real, bearing real, altitude float8, battery_percentage smallint, provider text, network_status text,
      is_mock boolean, recorded_at timestamptz)
  ), classified as (
    select p.*, case
      when p.id is null then 'MISSING_ID'
      when p.recorded_at is null then 'MISSING_RECORDED_AT'
      when p.latitude is null or p.longitude is null or p.latitude not between -90 and 90
           or p.longitude not between -180 and 180 then 'INVALID_COORDINATES'
      when p.accuracy < 0 or p.speed < 0 or p.bearing < 0 or p.bearing > 360 then 'INVALID_VALUE'
      when p.battery_percentage not between 0 and 100 then 'INVALID_BATTERY'
      when p.network_status is not null and p.network_status not in ('wifi', 'cellular', 'none', 'other', 'unknown') then 'INVALID_NETWORK_STATUS'
      when p.recorded_at > now() + make_interval(secs => v_skew) then 'TIMESTAMP_IN_FUTURE'
      when p.recorded_at < s.started_at - interval '1 minute' then 'BEFORE_SESSION_START'
      when s.ended_at is not null and p.recorded_at > s.ended_at then 'AFTER_SESSION_END'
      end as reject_reason
    from parsed p
  ), ins as (
    insert into public.location_records (id, company_id, employee_id, tracking_session_id, latitude, longitude, accuracy,
        speed, bearing, altitude, battery_percentage, provider, network_status, is_mock, recorded_at)
      select c.id, e.company_id, e.id, s.id, c.latitude, c.longitude, c.accuracy, c.speed, c.bearing, c.altitude,
             c.battery_percentage, c.provider, c.network_status, coalesce(c.is_mock, false), c.recorded_at
      from classified c where c.reject_reason is null
      on conflict (id, recorded_at) do nothing
      returning id, recorded_at, latitude, longitude, accuracy, battery_percentage
  )
  select (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'reason', c.reject_reason)), '[]') from classified c where c.reject_reason is not null),
         (select coalesce(jsonb_agg(to_jsonb(i) order by i.recorded_at), '[]') from ins i)
    into v_rejected, v_inserted;

  v_accepted := jsonb_array_length(v_inserted);
  for r in select (x ->> 'id')::uuid as id, (x ->> 'recorded_at')::timestamptz as recorded_at,
                  (x ->> 'latitude')::float8 as lat, (x ->> 'longitude')::float8 as lng,
                  (x ->> 'accuracy')::real as acc, (x ->> 'battery_percentage')::smallint as bat
           from jsonb_array_elements(v_inserted) x order by 2 loop
    perform app.process_geofences(e.id, e.company_id, s.id, r.recorded_at, r.lat, r.lng, r.acc);
    update public.employee_live_status set last_lat = r.lat, last_lng = r.lng, last_accuracy = r.acc, last_battery = r.bat,
      last_recorded_at = r.recorded_at, last_received_at = now(), updated_at = now()
      where employee_id = e.id and tracking_session_id = s.id and (last_recorded_at is null or last_recorded_at < r.recorded_at);
  end loop;
  return jsonb_build_object('accepted', v_accepted,
    'duplicates', v_total - v_accepted - jsonb_array_length(v_rejected), 'rejected', v_rejected);
end $$;

create function public.record_heartbeat(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e public.employees := app.require_employee(); h record; v_dev uuid; v_sess uuid; v_drift integer; v_status public.health_status; v_reasons text[];
begin
  select * into h from jsonb_to_record(p) as x(device_uid text, captured_at timestamptz, battery_percentage smallint,
    is_charging boolean, power_save_mode boolean, location_permission text, background_location_granted boolean,
    location_services_enabled boolean, location_provider text, notifications_enabled boolean,
    battery_optimization_exempt boolean, network_type text, queue_pending integer, oldest_unsynced_at timestamptz,
    app_version text, os_version text, device_model text, mock_location_detected boolean,
    foreground_service_alive boolean, last_fix_at timestamptz, is_realtime boolean);
  if h.captured_at is null or h.device_uid is null then raise exception 'INVALID_PAYLOAD'; end if;
  select id into v_dev from public.employee_devices where employee_id = e.id and device_uid = h.device_uid and is_active;
  if v_dev is null then raise exception 'DEVICE_NOT_REGISTERED'; end if;
  select tracking_session_id into v_sess from public.employee_live_status where employee_id = e.id and is_checked_in;
  v_drift := case when h.is_realtime is true then round(extract(epoch from (h.captured_at - now())))::integer end;
  select d.status, d.reasons into v_status, v_reasons from app.derive_health(e.company_id, h.battery_percentage,
    h.is_charging, h.power_save_mode, h.location_permission, h.location_services_enabled, h.notifications_enabled,
    h.battery_optimization_exempt, h.network_type, h.queue_pending, h.mock_location_detected, v_drift,
    h.foreground_service_alive, v_sess is not null) d;
  insert into public.device_health_snapshots (company_id, employee_id, device_id, tracking_session_id, captured_at,
      battery_percentage, is_charging, power_save_mode, location_permission, background_location_granted,
      location_services_enabled, location_provider, notifications_enabled, battery_optimization_exempt, network_type,
      queue_pending, oldest_unsynced_at, app_version, os_version, device_model, mock_location_detected,
      clock_drift_seconds, foreground_service_alive, last_fix_at, status, status_reasons)
    values (e.company_id, e.id, v_dev, v_sess, h.captured_at, h.battery_percentage, h.is_charging, h.power_save_mode,
      h.location_permission, h.background_location_granted, h.location_services_enabled, h.location_provider,
      h.notifications_enabled, h.battery_optimization_exempt, h.network_type, h.queue_pending, h.oldest_unsynced_at,
      h.app_version, h.os_version, h.device_model, coalesce(h.mock_location_detected, false), v_drift,
      h.foreground_service_alive, h.last_fix_at, v_status, v_reasons)
    on conflict (device_id, captured_at) do nothing;
  insert into public.employee_live_status (employee_id, company_id, health_status, health_reasons, last_heartbeat_at)
    values (e.id, e.company_id, v_status, v_reasons, now())
    on conflict (employee_id) do update set health_status = excluded.health_status,
      health_reasons = excluded.health_reasons, last_heartbeat_at = now(), updated_at = now();
  update public.employee_devices set last_seen_at = now(), app_version = coalesce(h.app_version, app_version),
    os_version = coalesce(h.os_version, os_version) where id = v_dev;
  return jsonb_build_object('status', v_status, 'reasons', to_jsonb(v_reasons));
end $$;

create function public.report_interruption(p_id uuid, p_session_id uuid, p_started_at timestamptz,
  p_ended_at timestamptz, p_reason text, p_detail text) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.employees := app.require_employee();
begin
  if not exists (select 1 from public.tracking_sessions where id = p_session_id and employee_id = e.id) then
    raise exception 'SESSION_NOT_FOUND'; end if;
  insert into public.tracking_interruptions (id, company_id, employee_id, tracking_session_id, started_at, ended_at, reason, source, detail)
    values (p_id, e.company_id, e.id, p_session_id, p_started_at, p_ended_at, p_reason::public.interruption_reason,
            'device_reported', left(p_detail, 500))
    on conflict (id) do update set ended_at = coalesce(excluded.ended_at, public.tracking_interruptions.ended_at)
      where public.tracking_interruptions.employee_id = e.id;
end $$;

create function public.get_tracking_config() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.employees := app.require_employee();
begin
  return jsonb_build_object('server_time', now(), 'settings', coalesce((
    select jsonb_object_agg(key, value) from (
      select distinct on (key) key, value from public.system_settings
      where (company_id = e.company_id or company_id is null)
        and (key like 'tracking.%' or key like 'health.%' or key like 'ingest.%' or key like 'checkin.%')
      order by key, company_id nulls last) s), '{}'));
end $$;

-- Admin/manager access log for viewing sensitive data (live location, route history, exports).
create function public.log_admin_access(p_action text, p_employee_id uuid, p_details jsonb default '{}') returns void
language plpgsql security definer set search_path = '' as $$
declare v_company uuid;
begin
  if (select app.my_role()) not in ('super_admin', 'company_admin', 'manager') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_action not in ('live_location', 'route_history', 'attendance', 'report', 'export') then raise exception 'INVALID_ACTION'; end if;
  if not app.can_view_employee(p_employee_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select company_id into v_company from public.employees where id = p_employee_id;
  insert into public.audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
    values (v_company, (select auth.uid()), 'VIEW_' || upper(p_action), 'employees', p_employee_id::text, coalesce(p_details, '{}'));
end $$;

-- Audited manual correction (e.g. forgotten check-out). The only path that may modify finalized attendance.
create function public.admin_correct_attendance(p_attendance_id uuid, p_check_in_at timestamptz,
  p_check_out_at timestamptz, p_reason text) returns public.attendance
language plpgsql security definer set search_path = '' as $$
declare a public.attendance; old_row jsonb; new_in timestamptz; new_out timestamptz; tz text; sh uuid;
begin
  select * into a from public.attendance where id = p_attendance_id for update;
  if not found then raise exception 'ATTENDANCE_NOT_FOUND'; end if;
  if not ((select app.is_super_admin()) or ((select app.my_role()) = 'company_admin' and a.company_id = (select app.my_company_id()))) then
    raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
  new_in := coalesce(p_check_in_at, a.check_in_at);
  new_out := coalesce(p_check_out_at, a.check_out_at);
  if new_out is not null and new_out <= new_in then raise exception 'INVALID_TIMES'; end if;
  if new_in > now() or new_out > now() then raise exception 'TIMESTAMP_IN_FUTURE'; end if;
  old_row := to_jsonb(a);
  select timezone into tz from public.companies where id = a.company_id;
  select shift_id into sh from public.employees where id = a.employee_id;
  perform set_config('app.allow_correction', 'on', true);
  update public.attendance set check_in_at = new_in, check_out_at = new_out,
    status = (case when new_out is null then 'open' else 'closed' end)::public.attendance_status,
    worked_seconds = case when new_out is null then null else floor(extract(epoch from (new_out - new_in)))::integer end,
    work_date = (new_in at time zone tz)::date, late_minutes = app.calc_late(a.company_id, sh, new_in),
    finalized_at = case when new_out is not null then coalesce(finalized_at, now()) end,
    check_out_received_at = case when new_out is not null then coalesce(check_out_received_at, now()) end,
    corrected_at = now(), corrected_by = (select auth.uid()), correction_reason = btrim(p_reason)
    where id = a.id returning * into a;
  if a.status = 'closed' then
    update public.tracking_sessions set status = 'ended', ended_at = a.check_out_at, end_reason = 'admin_close'
      where attendance_id = a.id and ended_at is null;
    update public.employee_live_status set is_checked_in = false, tracking_session_id = null, updated_at = now()
      where employee_id = a.employee_id and attendance_id = a.id;
  end if;
  perform set_config('app.allow_correction', 'off', true);
  insert into public.audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
    values (a.company_id, (select auth.uid()), 'CORRECT_ATTENDANCE', 'attendance', a.id::text,
            jsonb_build_object('old', old_row, 'new', to_jsonb(a), 'reason', btrim(p_reason)));
  return a;
end $$;

-- Retention: drop whole monthly partitions older than the window; trim health snapshots.
create function app.purge_expired() returns jsonb language plpgsql security definer set search_path = '' as $$
declare p record; v_days integer := app.setting_num(null, 'retention.location_days')::integer;
  v_hdays integer := app.setting_num(null, 'retention.health_days')::integer; v_dropped integer := 0; v_health bigint;
begin
  for p in select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid
           where i.inhparent = 'public.location_records'::regclass and c.relname ~ '^location_records_y[0-9]{4}m[0-9]{2}$' loop
    if (to_date(substr(p.relname, 19, 4) || substr(p.relname, 24, 2), 'YYYYMM') + interval '1 month') < (now() - make_interval(days => v_days)) then
      execute format('drop table public.%I', p.relname); v_dropped := v_dropped + 1;
    end if;
  end loop;
  delete from public.device_health_snapshots where received_at < now() - make_interval(days => v_hdays);
  get diagnostics v_health = row_count;
  delete from public.login_attempts where attempted_at < now() - interval '7 days';
  return jsonb_build_object('partitions_dropped', v_dropped, 'health_rows_deleted', v_health);
end $$;

do $$ begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron not enabled (%): schedule app.ensure_location_partitions and app.purge_expired manually', sqlerrm; end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('attendo_partitions', '0 2 20 * *', 'select app.ensure_location_partitions(1, 3)');
    perform cron.schedule('attendo_purge', '30 2 * * *', 'select app.purge_expired()');
  end if;
end $$;

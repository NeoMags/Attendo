-- Round 1: exit alert notifications, user_prefs isolation, field schedule RLS.
do $$
declare ca uuid := t.id('cA'); cb uuid := t.id('cB'); sh uuid; gid uuid := t.id('gf1'); n bigint; sid uuid;
begin
  -- exit trigger: insert an exit event as the owner and check the notification
  perform t.service();
  select id into sid from public.tracking_sessions where employee_id = t.id('eA1') limit 1;
  perform t.logout();
  insert into public.geofence_events (company_id, employee_id, geofence_id, tracking_session_id, event_type, occurred_at, confirmed_at, fixes_used)
    select ca, s.employee_id, gid, s.id, 'exit', now(), now(), 2 from public.tracking_sessions s where s.id = sid;
  perform t.ok((select count(*) from public.notifications where kind = 'geofence_exit' and employee_id is null and company_id = ca) >= 1, 'exit event creates an admin notification');
  update public.geofences set alert_on_exit = false where id = gid;
  select count(*) into n from public.notifications where kind = 'geofence_exit';
  insert into public.geofence_events (company_id, employee_id, geofence_id, tracking_session_id, event_type, occurred_at, confirmed_at, fixes_used)
    select ca, s.employee_id, gid, s.id, 'exit', now(), now(), 2 from public.tracking_sessions s where s.id = sid;
  perform t.ok((select count(*) from public.notifications where kind = 'geofence_exit') = n, 'no alert when geofence alert_on_exit is off');
  update public.geofences set alert_on_exit = true where id = gid;

  -- visibility
  perform t.login(t.id('uAA'));
  perform t.ok((select count(*) from public.notifications where kind = 'geofence_exit') >= 1, 'company admin sees exit alerts');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.ok((select count(*) from public.notifications where kind = 'geofence_exit') = 0, 'other company admin does not see them');
  perform t.logout();
  perform t.login(t.id('uA1'));
  perform t.ok((select count(*) from public.notifications where kind = 'geofence_exit') = 0, 'employee does not see admin exit alerts');
  perform t.logout();
  perform t.login(t.id('uMA'));
  perform t.ok((select count(*) from public.notifications where kind = 'geofence_exit') >= 1, 'manager sees exit alert of a team member');
  perform t.logout();

  -- user_prefs
  perform t.login(t.id('uAA'));
  insert into public.user_prefs (user_id, notif_seen_at, dashboard_cards) values (t.id('uAA'), now(), '["active","absent"]');
  perform t.ok((select count(*) from public.user_prefs) = 1, 'user saves prefs');
  perform t.throws(format($q$insert into public.user_prefs (user_id) values (%L)$q$, t.id('uA1')), 'row-level security', 'cannot write another user''s prefs');
  perform t.throws($q$update public.user_prefs set dashboard_cards = '{"a":1}'$q$, 'check', 'dashboard_cards must be an array');
  perform t.logout();
  perform t.login(t.id('uA1'));
  perform t.ok((select count(*) from public.user_prefs) = 0, 'other users cannot read prefs');
  perform t.logout();

  -- field schedules
  perform t.login(t.id('uMA'));
  insert into public.field_schedules (company_id, employee_id, geofence_id, title, schedule_date, start_time, end_time)
    values (ca, t.id('eA1'), gid, 'Site visit', current_date, '09:00', '11:00');
  perform t.ok(true, 'manager schedules a team member');
  perform t.throws(format($q$insert into public.field_schedules (company_id, employee_id, title, schedule_date, start_time, end_time) values (%L, %L, 'X', current_date, '09:00', '11:00')$q$, ca, t.id('eA2')),
    'row-level security', 'manager cannot schedule a non-team employee');
  perform t.throws(format($q$insert into public.field_schedules (company_id, employee_id, title, schedule_date, start_time, end_time) values (%L, %L, 'X', current_date, '11:00', '09:00')$q$, ca, t.id('eA1')),
    'check', 'end must be after start');
  perform t.logout();
  perform t.login(t.id('uA1'));
  perform t.ok((select count(*) from public.field_schedules) = 1, 'employee sees own schedule');
  perform t.throws(format($q$insert into public.field_schedules (company_id, employee_id, title, schedule_date, start_time, end_time) values (%L, %L, 'Mine', current_date, '09:00', '11:00')$q$, ca, t.id('eA1')),
    'row-level security', 'employee cannot create schedules');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.ok((select count(*) from public.field_schedules) = 0, 'other company sees none');
  perform t.logout();
end $$;

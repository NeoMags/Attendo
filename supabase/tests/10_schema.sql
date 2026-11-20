-- Structure, privileges and tenant-integrity checks (run as superuser unless stated)
do $$
declare spec text[] := array['companies','employees','departments','user_roles','employee_devices','attendance',
  'tracking_sessions','location_records','geofences','geofence_events','notifications','audit_logs','system_settings'];
  extra text[] := array['tracking_interruptions','device_health_snapshots','employee_live_status','productivity_daily',
  'shifts','manager_assignments','geofence_state'];
begin
  perform t.ok((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p') and c.relname = any (spec)) = 13, 'all 13 spec tables exist');
  perform t.ok((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p') and c.relname = any (extra)) = 7, 'all 7 additional tables exist');
  perform t.ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p') and not c.relispartition), 'RLS enabled on every public table');
  perform t.ok((select bool_and(not has_table_privilege('anon', c.oid, 'SELECT')) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p','v')), 'anon has no SELECT on any public table/view');
  perform t.ok((select bool_and(not has_table_privilege('authenticated', c.oid, 'INSERT') and not has_table_privilege('authenticated', c.oid, 'DELETE'))
     from pg_class c where c.oid in ('public.attendance'::regclass, 'public.location_records'::regclass,
       'public.tracking_sessions'::regclass, 'public.device_health_snapshots'::regclass, 'public.audit_logs'::regclass,
       'public.geofence_events'::regclass, 'public.employee_live_status'::regclass, 'public.user_roles'::regclass)),
     'authenticated has no INSERT/DELETE on attendance/GPS/health/audit/roles tables');
  perform t.ok(not has_table_privilege('authenticated', 'public.attendance', 'UPDATE')
     and not has_table_privilege('authenticated', 'public.location_records', 'UPDATE'), 'authenticated has no UPDATE on attendance/location_records');
  perform t.ok(not has_table_privilege('authenticated', 'public.geofence_state', 'SELECT') and not has_table_privilege('authenticated', 'public.login_attempts', 'SELECT') and has_table_privilege('service_role', 'public.login_attempts', 'INSERT'), 'geofence_state/login_attempts hidden from clients, login_attempts writable by service_role');
  perform t.ok(not has_function_privilege('anon', 'public.check_in(uuid,uuid,text,timestamptz,double precision,double precision,real)', 'execute')
     and has_function_privilege('authenticated', 'public.check_in(uuid,uuid,text,timestamptz,double precision,double precision,real)', 'execute'),
     'check_in executable by authenticated only');
  perform t.ok(not has_function_privilege('authenticated', 'public.resolve_employee_login(text,text)', 'execute')
     and has_function_privilege('service_role', 'public.resolve_employee_login(text,text)', 'execute'), 'resolve_employee_login is service_role only');
  perform t.ok((select count(*) from public.system_settings where company_id is null) = 21, '21 global default settings seeded');
  perform t.ok(exists (select 1 from pg_indexes where tablename = 'location_records' and indexdef ilike '%gist%geog%'), 'PostGIS GiST index on location_records.geog');
  perform t.ok(exists (select 1 from pg_indexes where tablename = 'geofences' and indexdef ilike '%gist%geog%'), 'PostGIS GiST index on geofences.geog');
  perform t.ok((select count(*) from pg_inherits where inhparent = 'public.location_records'::regclass) >= 5, 'location_records has monthly partitions + default');
  perform t.ok(exists (select 1 from pg_indexes where indexname = 'attendance_one_open_per_employee'), 'unique partial index prevents duplicate open shifts');
end $$;

-- tenant integrity at FK level
do $$
declare ca uuid; cb uuid; ea uuid; ea2 uuid;
begin
  insert into public.companies (code, name) values ('acme', 'Acme Pvt Ltd') returning id into ca;
  insert into public.companies (code, name) values ('beta', 'Beta Traders') returning id into cb;
  insert into public.employees (company_id, employee_code, full_name) values (ca, 'tmp1', 'Tmp') returning id into ea;
  insert into public.employees (company_id, employee_code, full_name) values (ca, 'tmp2', 'Tmp2') returning id into ea2;
  perform t.throws(format($q$insert into public.manager_assignments (company_id, manager_employee_id, employee_id) values (%L, %L, %L)$q$, cb, ea, ea2),
    'foreign key', 'cross-tenant composite FK rejects employees of another company');
  perform t.throws($q$insert into public.companies (code, name, timezone) values ('zz', 'Z', 'Mars/Olympus')$q$, 'INVALID_TIMEZONE', 'invalid company timezone rejected');
  perform t.throws($q$insert into public.employees (company_id, employee_code, full_name, login_phone) select id, 'x1', 'X', '+919999999999' from public.companies limit 1$q$,
    'violates check', 'login_phone must be in the internal +999 range');
  perform t.throws(format($q$insert into public.employees (company_id, employee_code, full_name) values (%L, 'TMP1', 'Dup')$q$, ca),
    'duplicate key', 'employee_code unique per company, case-insensitive');
  delete from public.employees where id in (ea, ea2);
  delete from public.companies where code in ('acme', 'beta');
end $$;

-- Round 2: employee profile / payroll info RLS, private document storage policies, monthly leave-request limit.
do $$
declare ca uuid := t.id('cA'); cb uuid := t.id('cB'); a1 uuid := t.id('eA1'); a2 uuid := t.id('eA2');
  m0 date := date_trunc('month', current_date + 120)::date; d1 date; d2 date; d3 date; ty uuid; n bigint; u record;
begin
  d1 := m0 + ((8 - extract(isodow from m0)::int) % 7); d2 := d1 + 7; d3 := d1 + 14;
  -- ---- profile + payroll writes
  perform t.login(t.id('uAA'));
  insert into public.employee_profiles (employee_id, company_id, address, phone, alt_phone, referred_by, designation)
    values (a1, ca, '12 MG Road', '+919876543210', '+919876500000', 'Ravi', 'Field exec');
  insert into public.employee_payroll_info (employee_id, company_id, pay_type, monthly_salary, pf_eligible, pf_uan, esi_eligible, aadhaar_last4, bank_account, bank_ifsc)
    values (a1, ca, 'monthly', 18000, true, '123456789012', true, '1234', '123456789012', 'HDFC0001234');
  insert into public.employee_payroll_info (employee_id, company_id, pay_type, daily_wage) values (a2, ca, 'daily', 650);
  perform t.ok(true, 'company admin saves profile and payroll info');
  perform t.throws(format($q$insert into public.employee_payroll_info (employee_id, company_id, pay_type) values (%L, %L, 'monthly')$q$, t.id('eMA'), ca), 'check', 'monthly pay needs a monthly salary');
  perform t.throws(format($q$insert into public.employee_payroll_info (employee_id, company_id, pay_type, monthly_salary, daily_wage) values (%L, %L, 'daily', 1, 1)$q$, t.id('eMA'), ca), 'check', 'daily pay cannot also carry a monthly salary');
  perform t.throws(format($q$update public.employee_payroll_info set aadhaar_last4 = '12345' where employee_id = %L$q$, a1), 'check', 'only 4 Aadhaar digits can be stored');
  perform t.throws(format($q$update public.employee_payroll_info set bank_ifsc = 'bad' where employee_id = %L$q$, a1), 'check', 'IFSC format enforced');
  perform t.throws(format($q$update public.employee_payroll_info set pf_uan = '123' where employee_id = %L$q$, a1), 'check', 'UAN must be 12 digits');
  perform t.throws(format($q$update public.employee_profiles set phone = '98765' where employee_id = %L$q$, a1), 'check', 'phone must be international format');
  perform t.logout();

  perform t.login(t.id('uAB'));
  perform t.ok((select count(*) from public.employee_profiles) = 0 and (select count(*) from public.employee_payroll_info) = 0, 'other company admin sees nothing');
  perform t.throws(format($q$insert into public.employee_profiles (employee_id, company_id) values (%L, %L)$q$, a2, ca), 'row-level security', 'other company admin cannot write');
  perform t.logout();

  perform t.login(t.id('uMA'));
  perform t.ok((select count(*) from public.employee_profiles where employee_id = a1) = 1, 'manager reads team member profile');
  perform t.ok((select count(*) from public.employee_profiles where employee_id = a2) = 0, 'manager cannot read non-team profile');
  perform t.ok((select count(*) from public.employee_payroll_info) = 0, 'manager cannot read pay data');
  perform t.ok(t.rows(format($q$update public.employee_profiles set address = 'x' where employee_id = %L$q$, a1)) = 0, 'manager cannot edit profile');
  perform t.logout();

  perform t.login(t.id('uA1'));
  perform t.ok((select count(*) from public.employee_payroll_info) = 1 and (select monthly_salary from public.employee_payroll_info) = 18000, 'employee reads only own pay info');
  perform t.ok((select count(*) from public.employee_profiles) = 1, 'employee reads only own profile');
  perform t.ok(t.rows(format($q$update public.employee_payroll_info set monthly_salary = 99999 where employee_id = %L$q$, a1)) = 0, 'employee cannot change own salary');
  perform t.throws(format($q$insert into public.employee_profiles (employee_id, company_id) values (%L, %L)$q$, a1, ca), 'row-level security', 'employee cannot write profile');
  perform t.logout();

  -- ---- storage policies
  perform t.login(t.id('uAA'));
  insert into storage.objects (bucket_id, name) values ('employee-docs', ca || '/' || a1 || '/photo.jpg'), ('employee-docs', ca || '/' || a1 || '/aadhaar.jpg'), ('employee-docs', ca || '/' || a2 || '/aadhaar.png');
  perform t.ok(true, 'admin uploads photo and Aadhaar under own company');
  perform t.throws(format($q$insert into storage.objects (bucket_id, name) values ('employee-docs', '%s/%s/passport.jpg')$q$, ca, a1), 'row-level security', 'unexpected file name rejected');
  perform t.throws(format($q$insert into storage.objects (bucket_id, name) values ('employee-docs', '%s/%s/photo.jpg')$q$, cb, a1), 'row-level security', 'admin cannot upload into another company folder');
  perform t.logout();
  perform t.login(t.id('uA1'));
  perform t.ok((select count(*) from storage.objects) = 2, 'employee sees only own two documents');
  perform t.ok(t.rows(format($q$delete from storage.objects where name like '%s/%s/%%'$q$, ca, a1)) = 0, 'employee cannot delete documents');
  perform t.logout();
  perform t.login(t.id('uMA'));
  perform t.ok((select count(*) from storage.objects) = 1 and (select name from storage.objects) like '%/photo.jpg', 'manager sees only the team member photo, not Aadhaar');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.ok((select count(*) from storage.objects) = 0, 'other company sees no documents');
  perform t.logout();

  -- ---- monthly leave request limit
  perform t.login(t.id('uAA'));
  insert into public.leave_types (company_id, name, annual_quota_days) values (ca, 'LimitTest', null) returning id into ty;
  insert into public.company_settings (company_id, monthly_leave_request_limit) values (ca, 1);
  perform t.logout();
  perform t.login(t.id('uA1'));
  perform public.apply_leave(ty, d1, d1);
  perform t.throws(format($q$select public.apply_leave(%L, %L, %L)$q$, ty, d2, d2), 'LEAVE_LIMIT_REACHED', 'second request in the same month hits the company limit');
  perform t.ok((select limit_per_month from public.leave_request_usage(extract(year from d1)::int, extract(month from d1)::int)) = 1
    and (select used from public.leave_request_usage(extract(year from d1)::int, extract(month from d1)::int)) = 1, 'usage reports limit 1, used 1');
  perform t.logout();
  perform t.login(t.id('uAA'));
  update public.employee_profiles set leave_request_limit_override = 3 where employee_id = a1;
  perform t.logout();
  perform t.login(t.id('uA1'));
  perform public.apply_leave(ty, d2, d2);
  perform t.ok(true, 'per-employee override allows more requests');
  perform t.logout();
  perform t.login(t.id('uA1'));
  perform t.ok((select count(*) from public.company_settings) = 1, 'employee can read company settings');
  perform t.ok(t.rows($q$update public.company_settings set monthly_leave_request_limit = 99$q$) = 0, 'employee cannot change the limit');
  perform t.logout();
end $$;

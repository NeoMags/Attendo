-- Regression: Edge Functions run as service_role and insert employees (login_phone default uses a sequence).
do $$
declare c uuid; ph text;
begin
  insert into public.companies (code, name) values ('svc', 'Svc Co') returning id into c;
  perform t.service();
  insert into public.employees (company_id, employee_code, full_name) values (c, 'S1', 'Svc One') returning login_phone into ph;
  perform t.logout();
  perform t.ok(ph ~ '^\+999[0-9]{11}$', 'service_role can insert employee; login_phone auto-generated', ph);
  perform t.login(gen_random_uuid());
  perform t.throws($q$select app.next_login_phone()$q$, 'permission denied', 'authenticated cannot call next_login_phone');
  perform t.logout();
  delete from public.employees where company_id = c;
  delete from public.companies where id = c;
end $$;

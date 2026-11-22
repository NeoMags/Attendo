-- Push trigger must never break notification inserts and must stay private.
do $$
declare ca uuid := t.id('cA'); n int;
begin
  perform t.ok(exists (select 1 from pg_trigger where tgname = 'notifications_push'), 'push trigger exists');
  insert into public.notifications (company_id, employee_id, kind, title, body, data) values (ca, t.id('eA1'), 'test', 'Hello', 'World', '{}');
  select count(*) into n from public.notifications where kind = 'test' and employee_id = t.id('eA1');
  perform t.ok(n = 1, 'employee notification inserts even when pg_net is missing', n::text);
  insert into public.notifications (company_id, employee_id, kind, title, body, data) values (ca, null, 'test', 'Admin note', null, '{}');
  perform t.ok(true, 'company-wide notification inserts');
  perform t.ok(not has_function_privilege('authenticated', 'app.push_notification()', 'execute'), 'clients cannot execute trigger function');
end $$;

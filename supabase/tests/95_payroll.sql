-- Round 4a: payroll calculation, advances + recovery, ledger, RLS, templates.
do $$
declare ca uuid := t.id('cA'); a1 uuid := t.id('eA1'); a2 uuid := t.id('eA2'); mA uuid := t.id('eMA'); lt uuid; run public.payroll_runs; ps public.payslips; ps2 public.payslips;
  adv public.employee_advances; n int; run2 public.payroll_runs; sh uuid;
begin
  -- fixtures (as superuser): pay info, a Mon-Sat shift is the default (Sundays off). Feb 2026 has 28 days and 4 Sundays => 24 working days.
  insert into public.shifts (company_id, name, start_time, end_time, working_days) values (ca, 'PayrollTest Mon-Sat', '09:00', '18:00', '{1,2,3,4,5,6}') returning id into sh;
  update public.employees set shift_id = sh where id in (a1, a2);
  insert into public.employee_payroll_info (employee_id, company_id, pay_type, monthly_salary) values (a1, ca, 'monthly', 24000)
    on conflict (employee_id) do update set pay_type = 'monthly', monthly_salary = 24000, daily_wage = null;
  insert into public.employee_payroll_info (employee_id, company_id, pay_type, daily_wage) values (a2, ca, 'daily', 650)
    on conflict (employee_id) do update set pay_type = 'daily', daily_wage = 650, monthly_salary = null;
  insert into public.leave_types (company_id, name) values (ca, 'PayrollTest') returning id into lt;
  insert into public.attendance (id, company_id, employee_id, work_date, status, check_in_at, check_in_lat, check_in_lng, check_in_accuracy, check_out_at)
    select gen_random_uuid(), ca, e, d, 'closed', d::timestamptz + interval '9 hours', 1, 1, 5, d::timestamptz + interval '17 hours'
    from (values (a1, date '2026-02-01'), (a1, date '2026-02-02'), (a1, date '2026-02-03'), (a1, date '2026-02-04'), (a2, date '2026-02-02'), (a2, date '2026-02-03')) v(e, d);
  insert into public.company_holidays (company_id, holiday_date, name) values (ca, '2026-02-05', 'Test holiday');
  insert into public.leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, days, status, is_paid) values
    (ca, a1, lt, '2026-02-06', '2026-02-06', 1, 'approved', true), (ca, a1, lt, '2026-02-09', '2026-02-09', 1, 'approved', false);

  -- permissions
  perform t.login(t.id('uA1'));
  perform t.throws(format($q$select public.generate_payroll(%L, '2026-02-01')$q$, ca), 'FORBIDDEN', 'employee cannot run payroll');
  perform t.throws(format($q$select public.give_advance(%L, %L, 100, current_date)$q$, ca, a1), 'FORBIDDEN', 'employee cannot give advances');
  perform t.logout();
  perform t.login(t.id('uMA'));
  perform t.throws(format($q$select public.generate_payroll(%L, '2026-02-01')$q$, ca), 'FORBIDDEN', 'manager cannot run payroll');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.throws(format($q$select public.generate_payroll(%L, '2026-02-01')$q$, ca), 'FORBIDDEN', 'other company admin cannot run payroll');
  perform t.logout();

  perform t.login(t.id('uAA'));
  perform t.throws(format($q$select public.generate_payroll(%L, current_date + 70)$q$, ca), 'MONTH_IN_FUTURE', 'cannot run a future month');
  adv := public.give_advance(ca, a1, 3000, '2026-01-20', 'Medical', 1000);
  perform t.throws(format($q$select public.give_advance(%L, %L, 100, current_date, null, 200)$q$, ca, a1), 'INVALID_INSTALLMENT', 'installment cannot exceed the advance');
  perform t.throws(format($q$select public.give_advance(%L, %L, 0, current_date)$q$, ca, a1), 'INVALID_AMOUNT', 'amount must be positive');
  perform t.ok(exists (select 1 from public.ledger_entries where ref_id = adv.id and kind = 'advance_given' and direction = 'to_employee' and amount = 3000), 'advance is written to the ledger');

  run := public.generate_payroll(ca, '2026-02-17');
  perform t.ok(run.month = '2026-02-01' and run.status = 'draft', 'run is for the first of the month, as a draft');
  select * into ps from public.payslips where run_id = run.id and employee_id = a1;
  perform t.ok(ps.working_days = 23 and ps.present_days = 3 and ps.holiday_days = 0 and ps.paid_leave_days = 1 and ps.unpaid_leave_days = 1 and ps.absent_days = 18,
    'day classification: 23 working (holiday excluded), 3 present (Sunday visit ignored), 1 paid leave, 1 unpaid leave, 18 absent',
    format('%s/%s/%s/%s/%s/%s', ps.working_days, ps.present_days, ps.holiday_days, ps.paid_leave_days, ps.unpaid_leave_days, ps.absent_days));
  perform t.ok(ps.gross = 4173.91, 'monthly pay = 24000 / 23 x (3 + 1) = 4173.91 (holiday is not a working day)', ps.gross::text);
  perform t.ok(ps.advance_deduction = 1000 and ps.net = 3173.91, 'monthly installment of 1000 is deducted', format('%s / %s', ps.advance_deduction, ps.net));
  select * into ps2 from public.payslips where run_id = run.id and employee_id = a2;
  perform t.ok(ps2.gross = 1300 and ps2.net = 1300, 'daily wage = 650 x 2 present days', ps2.gross::text);

  ps := public.set_payslip_adjustment(ps.id, 200, 0, 'festival bonus', false);
  perform t.ok(ps.bonus = 200 and ps.net = 3373.91, 'bonus raises net', ps.net::text);
  perform t.throws(format($q$select public.set_payslip_adjustment(%L, 0, 99999)$q$, ps.id), 'DEDUCTION_EXCEEDS_PAY', 'other deduction cannot exceed pay');
  ps := public.set_payslip_adjustment(ps.id, 200, 0, 'festival bonus', true);
  perform t.ok(ps.advance_deduction = 0 and ps.net = 4373.91, 'advance recovery can be skipped for a month', ps.net::text);
  ps := public.set_payslip_adjustment(ps.id, 200, 0, 'festival bonus', false);

  -- regenerate keeps adjustments
  run := public.generate_payroll(ca, '2026-02-01');
  select * into ps from public.payslips where run_id = run.id and employee_id = a1;
  perform t.ok(ps.bonus = 200 and ps.net = 3373.91, 'regenerating a draft keeps manual adjustments');
  perform t.logout();

  -- employee cannot see a draft payslip
  perform t.login(t.id('uA1'));
  perform t.ok((select count(*) from public.payslips) = 0, 'employee does not see draft payslips');
  perform t.ok((select count(*) from public.employee_advances) = 1, 'employee sees own advances');
  perform t.logout();

  perform t.login(t.id('uAA'));
  run := public.finalize_payroll(run.id);
  perform t.ok(run.status = 'finalized', 'run finalized');
  perform t.throws(format($q$select public.generate_payroll(%L, '2026-02-01')$q$, ca), 'RUN_FINALIZED', 'finalized run cannot be regenerated');
  perform t.throws(format($q$select public.finalize_payroll(%L)$q$, run.id), 'RUN_FINALIZED', 'cannot finalize twice');
  perform t.throws(format($q$select public.set_payslip_adjustment(%L, 0, 0)$q$, ps.id), 'RUN_FINALIZED', 'finalized payslip is locked');
  perform t.ok((select remaining from public.advance_balances where id = adv.id) = 2000, 'advance balance reduced by the recovery');
  perform t.ok(exists (select 1 from public.ledger_entries where kind = 'advance_recovered' and employee_id = a1 and amount = 1000 and direction = 'from_employee'), 'recovery is in the ledger');
  perform t.ok(exists (select 1 from public.notifications where employee_id = a1 and kind = 'payslip'), 'employee is notified');
  perform t.throws(format($q$select public.mark_payslip_paid(%L, current_date, 'gold')$q$, ps.id), 'INVALID_MODE', 'payment mode validated');
  ps := public.mark_payslip_paid(ps.id, current_date, 'bank');
  perform t.ok(ps.paid_on is not null and exists (select 1 from public.ledger_entries where kind = 'salary_paid' and employee_id = a1 and amount = 3373.91), 'paying writes a salary entry for the net amount');
  perform t.throws(format($q$select public.mark_payslip_paid(%L, current_date, 'bank')$q$, ps.id), 'ALREADY_PAID', 'cannot pay twice');
  perform t.throws(format($q$update public.payslips set gross = 1 where id = %L$q$, ps.id), 'permission denied', 'clients cannot edit payslips directly');
  perform t.throws(format($q$insert into public.ledger_entries (company_id, employee_id, entry_date, kind, amount, direction) values (%L, %L, current_date, 'salary_paid', 1, 'to_employee')$q$, ca, a1), 'permission denied', 'clients cannot write the ledger');
  perform t.logout();

  -- second month: remaining advance continues to be recovered, capped at what is left
  perform t.login(t.id('uAA'));
  run2 := public.generate_payroll(ca, '2026-03-01');
  select * into ps2 from public.payslips where run_id = run2.id and employee_id = a1;
  perform t.ok(ps2.gross = 0 and ps2.advance_deduction = 0 and ps2.net = 0, 'a month with no pay recovers nothing; the balance carries over', ps2.advance_deduction::text);
  perform t.logout();

  -- visibility after finalize
  perform t.login(t.id('uA1'));
  perform t.ok((select count(*) from public.payslips) = 1 and (select net from public.payslips) = 3373.91, 'employee sees only their own finalized payslip');
  perform t.ok((select count(*) from public.ledger_entries) = 3, 'employee sees own ledger (advance, recovery, salary)', (select count(*) from public.ledger_entries)::text);
  perform t.ok((select count(*) from public.payroll_runs) = 0, 'employee cannot see payroll runs');
  perform t.logout();
  perform t.login(t.id('uMA'));
  perform t.ok((select count(*) from public.payslips) = 0 and (select count(*) from public.ledger_entries) = 0 and (select count(*) from public.employee_advances) = 0, 'manager sees no payroll data');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.ok((select count(*) from public.payslips) = 0 and (select count(*) from public.company_holidays) = 0, 'other company sees nothing');
  perform t.logout();

  -- templates: managers may write, employees may not
  perform t.login(t.id('uMA'));
  perform t.ok(t.rows(format($q$insert into public.payslip_templates (company_id, name, header_text) values (%L, 'Mgr draft', 'Acme')$q$, ca)) = 1, 'manager can draft a template');
  perform t.throws(format($q$insert into public.payslip_templates (company_id, name, accent) values (%L, 'bad', 'red')$q$, ca), 'check', 'accent must be a hex colour');
  perform t.logout();
  perform t.login(t.id('uA1'));
  perform t.throws(format($q$insert into public.payslip_templates (company_id, name) values (%L, 'emp')$q$, ca), 'row-level security', 'employee cannot write templates');
  perform t.ok((select count(*) from public.company_holidays) = 1, 'employee can read company holidays');
  perform t.throws(format($q$insert into public.company_holidays (company_id, holiday_date, name) values (%L, '2026-03-02', 'x')$q$, ca), 'row-level security', 'employee cannot write holidays');
  perform t.logout();
end $$;

-- Round 4 follow-up: reversing an advance recovery on an unpaid finalized payslip.
do $$
declare ca uuid := t.id('cA'); a2 uuid := t.id('eA2'); adv public.employee_advances; r1 uuid; r2 uuid; r3 uuid; p1 uuid; p2 uuid; p3 uuid; ps public.payslips; bal record;
begin
  perform t.login(t.id('uAA'));
  adv := public.give_advance(ca, a2, 2000, current_date);
  perform t.logout();
  insert into public.payroll_runs (company_id, month, status) values (ca, '2025-11-01', 'finalized') returning id into r1;
  insert into public.payroll_runs (company_id, month, status) values (ca, '2025-10-01', 'finalized') returning id into r2;
  insert into public.payroll_runs (company_id, month, status) values (ca, '2025-09-01', 'draft') returning id into r3;
  insert into public.payslips (run_id, company_id, employee_id, month, pay_type, daily_wage, working_days, present_days, holiday_days, paid_leave_days, unpaid_leave_days, absent_days, gross, advance_deduction, net, finalized)
    values (r1, ca, a2, '2025-11-01', 'daily', 500, 26, 10, 0, 0, 0, 16, 5000, 1000, 4000, true) returning id into p1;
  insert into public.payslips (run_id, company_id, employee_id, month, pay_type, daily_wage, working_days, present_days, holiday_days, paid_leave_days, unpaid_leave_days, absent_days, gross, advance_deduction, net, finalized, paid_on, payment_mode)
    values (r2, ca, a2, '2025-10-01', 'daily', 500, 26, 10, 0, 0, 0, 16, 5000, 300, 4700, true, current_date, 'cash') returning id into p2;
  insert into public.payslips (run_id, company_id, employee_id, month, pay_type, daily_wage, working_days, present_days, holiday_days, paid_leave_days, unpaid_leave_days, absent_days, gross, net)
    values (r3, ca, a2, '2025-09-01', 'daily', 500, 26, 10, 0, 0, 0, 16, 5000, 5000) returning id into p3;
  insert into public.advance_recoveries (company_id, advance_id, payslip_id, amount) values (ca, adv.id, p1, 1000), (ca, adv.id, p2, 300);
  select * into bal from public.advance_balances where id = adv.id;
  perform t.ok(bal.recovered = 1300 and bal.remaining = 700, 'before: 1,300 recovered, 700 left', bal.remaining::text);

  perform t.login(t.id('uA1'));
  perform t.throws(format($q$select public.reverse_advance_recovery(%L)$q$, p1), 'FORBIDDEN', 'employee cannot reverse');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.throws(format($q$select public.reverse_advance_recovery(%L)$q$, p1), 'FORBIDDEN', 'other company admin cannot reverse');
  perform t.logout();

  perform t.login(t.id('uAA'));
  perform t.throws(format($q$select public.reverse_advance_recovery(%L)$q$, p2), 'ALREADY_PAID', 'paid payslip cannot be reversed');
  perform t.throws(format($q$select public.reverse_advance_recovery(%L)$q$, p3), 'RUN_NOT_FINALIZED', 'draft payslip cannot be reversed');
  perform t.throws(format($q$select public.reverse_advance_recovery(%L)$q$, p3 || ''), 'RUN_NOT_FINALIZED', 'draft again');
  ps := public.reverse_advance_recovery(p1, 'Deducted by mistake');
  perform t.ok(ps.advance_deduction = 0 and ps.net = 5000 and ps.net = ps.gross + ps.bonus - ps.other_deduction - ps.advance_deduction, 'payslip deduction removed, net back to 5,000 and the invariant holds', ps.net::text);
  perform t.ok(ps.adjustment_note like '%reversed%', 'payslip carries a note', ps.adjustment_note);
  select * into bal from public.advance_balances where id = adv.id;
  perform t.ok(bal.recovered = 300 and bal.remaining = 1700, 'balance restored: 300 recovered (the paid month), 1,700 owed again', bal.remaining::text);
  perform t.ok(exists (select 1 from public.ledger_entries where kind = 'advance_reversed' and ref_id = p1 and amount = 1000 and direction = 'waived'), 'ledger shows the reversal; the original recovery entry stays as history');
  perform t.ok((select reverse_reason from public.advance_recoveries where payslip_id = p1) = 'Deducted by mistake', 'reason recorded');
  perform t.throws(format($q$select public.reverse_advance_recovery(%L)$q$, p1), 'NOTHING_TO_REVERSE', 'cannot reverse twice');
  perform t.logout();
  perform t.login(t.id('uA2'));
  perform t.ok((select count(*) from public.ledger_entries where kind = 'advance_reversed') = 1 and (select remaining from public.advance_balances where id = adv.id) = 1700, 'employee sees the reversal and the restored balance');
  perform t.logout();
end $$;

-- Round 4 follow-ups: half-day attendance in payroll, admin override, voiding advances.
do $$
declare ca uuid := t.id('cA'); a1 uuid := t.id('eA1'); lt uuid; sh uuid; d record; run public.payroll_runs; ps public.payslips; att uuid; adv1 uuid; adv2 uuid; n int;
begin
  insert into public.shifts (company_id, name, start_time, end_time, working_days, full_day_minutes, half_day_minutes)
    values (ca, 'HalfTest Mon-Sat', '09:00', '18:00', '{1,2,3,4,5,6}', 480, 240) returning id into sh;
  update public.employees set shift_id = sh where id = a1;
  perform t.throws(format($q$insert into public.shifts (company_id, name, start_time, end_time, full_day_minutes) values (%L, 'bad1', '09:00', '18:00', 480)$q$, ca), 'check', 'thresholds must be set together');
  perform t.throws(format($q$insert into public.shifts (company_id, name, start_time, end_time, full_day_minutes, half_day_minutes) values (%L, 'bad2', '09:00', '18:00', 240, 480)$q$, ca), 'check', 'half day must be shorter than full day');
  select id into lt from public.leave_types where company_id = ca and name = 'PayrollTest';
  -- April 2026: 30 days, Sundays 5/12/19/26 off => 26 working days
  insert into public.attendance (id, company_id, employee_id, work_date, status, check_in_at, check_in_lat, check_in_lng, check_in_accuracy, check_out_at, worked_seconds, day_fraction_override)
  select gen_random_uuid(), ca, a1, v.d, 'closed', v.d::timestamptz + interval '9 hours', 1, 1, 5, v.d::timestamptz + interval '18 hours', v.h * 3600, v.o
  from (values (date '2026-04-01', 9, null::numeric), ('2026-04-02', 5, null), ('2026-04-03', 2, null), ('2026-04-04', 2, 1.0), ('2026-04-05', 9, null), ('2026-04-06', 5, null)) v(d, h, o);
  insert into public.leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, days, status, is_paid, is_half_day)
    values (ca, a1, lt, '2026-04-06', '2026-04-06', 0.5, 'approved', true, true);

  select * into d from app.payroll_days(a1, '2026-04-01');
  perform t.ok(d.working_days = 26, '26 working days in April', d.working_days::text);
  perform t.ok(d.present_days = 3.0, 'full 1 + half 0.5 + short 0 + overridden 1 + half 0.5 = 3 (Sunday attendance ignored)', d.present_days::text);
  perform t.ok(d.paid_leave_days = 0.5, 'half-day paid leave covers the other half of the 6th', d.paid_leave_days::text);
  perform t.ok(d.absent_days = 22.5 and d.holiday_days = 0 and d.unpaid_leave_days = 0, 'absent is what remains', d.absent_days::text);
  perform t.ok(d.present_days + d.holiday_days + d.paid_leave_days + d.unpaid_leave_days + d.absent_days = d.working_days, 'day counts add up to working days');

  -- admin override
  select id into att from public.attendance where employee_id = a1 and work_date = '2026-04-03';
  perform t.login(t.id('uA1'));
  perform t.throws(format($q$select public.set_attendance_fraction(%L, 0.5)$q$, att), 'FORBIDDEN', 'employee cannot override attendance value');
  perform t.logout();
  perform t.login(t.id('uMA'));
  perform t.throws(format($q$select public.set_attendance_fraction(%L, 0.5)$q$, att), 'FORBIDDEN', 'manager cannot override attendance value');
  perform t.logout();
  perform t.login(t.id('uAA'));
  perform t.throws(format($q$select public.set_attendance_fraction(%L, 0.3)$q$, att), 'INVALID_FRACTION', 'only 0, 0.5 or 1');
  perform public.set_attendance_fraction(att, 0.5, 'Left early with permission');
  perform t.logout();
  select * into d from app.payroll_days(a1, '2026-04-01');
  perform t.ok(d.present_days = 3.5 and d.absent_days = 22, 'override changes payroll', d.present_days::text);

  -- payroll uses it: 24000 * (3.5 + 0.5) / 26
  perform t.login(t.id('uAA'));
  run := public.generate_payroll(ca, '2026-04-10');
  select * into ps from public.payslips where run_id = run.id and employee_id = a1;
  perform t.ok(ps.gross = round(24000 * 4.0 / 26, 2), 'gross uses half days', ps.gross::text);
  perform t.ok(ps.advance_deduction = 1000, 'advance installment planned', ps.advance_deduction::text);

  -- void advances
  select id into adv1 from public.employee_advances where employee_id = a1 order by given_on limit 1;   -- 3000, 1000 recovered
  adv2 := (public.give_advance(ca, a1, 600, '2026-04-08', 'Mistake', 300)).id;
  perform t.login(t.id('uA1'));
  perform t.throws(format($q$select public.void_advance(%L)$q$, adv2), 'FORBIDDEN', 'employee cannot void');
  perform t.logout();
  perform t.login(t.id('uAA'));
  perform public.void_advance(adv2, 'Entered by mistake');
  perform t.ok(exists (select 1 from public.ledger_entries where ref_id = adv2 and kind = 'advance_voided' and amount = 600 and direction = 'waived' and note like 'Advance cancelled%'), 'cancel is written to the ledger');
  perform t.throws(format($q$select public.void_advance(%L)$q$, adv2), 'ALREADY_VOIDED', 'cannot void twice');
  perform public.void_advance(adv1, 'Waived by owner');
  perform t.ok(exists (select 1 from public.ledger_entries where ref_id = adv1 and kind = 'advance_voided' and amount = 2000 and note like 'Balance written off%'), 'write-off covers only the unrecovered 2000');
  perform t.ok((select remaining from public.advance_balances where id = adv1) = 0 and (select recovered from public.advance_balances where id = adv1) = 1000 and (select voided from public.advance_balances where id = adv1), 'balance view shows recovered history and zero remaining');
  select * into ps from public.payslips where run_id = run.id and employee_id = a1;
  perform t.ok(ps.advance_deduction = 0 and ps.net = ps.gross, 'draft payslip stops recovering voided advances', ps.advance_deduction::text);
  perform t.throws(format($q$select public.void_advance(%L)$q$, adv1), 'ALREADY_VOIDED', 'cannot void a written-off advance again');
  perform t.logout();
  perform t.login(t.id('uA1'));
  perform t.ok((select count(*) from public.advance_balances where voided) = 2, 'employee sees their voided advances');
  perform t.logout();
end $$;

-- Round 5a: PF / ESI contribution computation, filings, permissions.
do $$
declare ca uuid := t.id('cA'); a1 uuid := t.id('eA1'); a2 uuid := t.id('eA2'); mA uuid := t.id('eMA'); r1 uuid; r2 uuid; r3 uuid; r4 uuid; c record; s jsonb; f public.statutory_filings; n int;
begin
  update public.employee_payroll_info set pf_eligible = true, pf_uan = '100000000001', esi_eligible = true, esi_ip_number = '1234567890' where employee_id = a1;
  update public.employee_payroll_info set pf_eligible = true, pf_uan = '100000000002', esi_eligible = true, esi_ip_number = null where employee_id = a2;
  insert into public.employee_payroll_info (employee_id, company_id, pay_type, daily_wage, esi_eligible, esi_ip_number) values (mA, ca, 'daily', 170, true, '1234567891');
  -- fixtures: finalized runs inserted directly (computation under test does not depend on how payslips were generated)
  insert into public.payroll_runs (company_id, month, status) values (ca, '2026-10-01', 'finalized') returning id into r1;
  insert into public.payroll_runs (company_id, month, status) values (ca, '2026-09-01', 'finalized') returning id into r2;
  insert into public.payroll_runs (company_id, month, status) values (ca, '2026-08-01', 'finalized') returning id into r3;
  insert into public.payroll_runs (company_id, month, status) values (ca, '2026-07-01', 'draft') returning id into r4;
  insert into public.payslips (run_id, company_id, employee_id, month, pay_type, monthly_salary, daily_wage, working_days, present_days, holiday_days, paid_leave_days, unpaid_leave_days, absent_days, gross, net, finalized) values
    (r1, ca, a1, '2026-10-01', 'monthly', 24000, null, 26, 26, 0, 0, 0, 0, 24000, 24000, true),
    (r1, ca, a2, '2026-10-01', 'daily', null, 650, 26, 20, 0, 0, 0, 6, 13000, 13000, true),
    (r1, ca, mA, '2026-10-01', 'daily', null, 170, 26, 25, 0, 0, 0, 1, 4250, 4250, true),
    (r2, ca, a1, '2026-09-01', 'monthly', 30000, null, 26, 26, 0, 0, 0, 0, 30000, 30000, true),
    (r3, ca, a1, '2026-08-01', 'monthly', 20000, null, 26, 25.5, 0, 0, 0.5, 0, 20000, 20000, true),
    (r4, ca, a1, '2026-07-01', 'monthly', 20000, null, 26, 26, 0, 0, 0, 0, 20000, 20000, false);

  -- permissions
  perform t.login(t.id('uA1'));
  perform t.throws(format($q$select * from public.statutory_contributions(%L, '2026-10-01')$q$, ca), 'FORBIDDEN', 'employee cannot read statutory data');
  perform t.logout();
  perform t.login(t.id('uMA'));
  perform t.throws(format($q$select * from public.statutory_summary(%L, '2026-10-01')$q$, ca), 'FORBIDDEN', 'manager cannot read statutory data');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.throws(format($q$select * from public.statutory_contributions(%L, '2026-10-01')$q$, ca), 'FORBIDDEN', 'other company admin cannot read statutory data');
  perform t.logout();

  perform t.login(t.id('uAA'));
  perform t.throws(format($q$select * from public.statutory_contributions(%L, '2026-07-01')$q$, ca), 'RUN_NOT_FINALIZED', 'draft month refused');
  perform t.throws(format($q$select * from public.statutory_contributions(%L, '2027-01-01')$q$, ca), 'RUN_NOT_FINALIZED', 'month without a run refused');

  -- October 2026: ceiling 25,000
  select * into c from public.statutory_contributions(ca, '2026-10-01') where employee_id = a1;
  perform t.ok(c.pf_ceiling = 25000 and c.epf_wages = 24000 and c.eps_wages = 24000 and c.edli_wages = 24000, 'a1 Oct: wages under the 25,000 ceiling are used in full', c.epf_wages::text);
  perform t.ok(c.ee_epf = 2880 and c.er_eps = 1999 and c.er_epf = 881 and c.ee_epf = c.er_eps + c.er_epf, 'a1 Oct: 12% = 2880; EPS 8.33% = 1999; EPF 881', c.er_eps::text);
  perform t.ok(c.ncp_days = 0 and not c.esi_applies and 'ESI_ABOVE_CEILING' = any (c.warnings) and c.esi_employee = 0, 'a1 Oct: salary 24,000 is above the ESI ceiling => excluded and flagged');
  select * into c from public.statutory_contributions(ca, '2026-10-01') where employee_id = a2;
  perform t.ok(c.epf_wages = 13000 and c.ee_epf = 1560 and c.er_eps = 1083 and c.er_epf = 477 and c.ncp_days = 6, 'a2 Oct: PF on 13,000, NCP = 6', c.er_eps::text);
  perform t.ok(c.esi_applies and c.esi_wages = 13000 and c.esi_days = 20 and c.esi_employee = 98 and c.esi_employer = 423, 'a2 Oct: ESI 0.75% = 97.5 -> 98, 3.25% = 422.5 -> 423', c.esi_employee::text || '/' || c.esi_employer::text);
  perform t.ok('MISSING_ESI_IP' = any (c.warnings) and not ('MISSING_UAN' = any (c.warnings)), 'a2 Oct: missing ESI IP flagged');
  select * into c from public.statutory_contributions(ca, '2026-10-01') where employee_id = mA;
  perform t.ok(c.esi_applies and c.esi_employee = 0 and c.esi_employer = 139 and not c.pf_applies and c.epf_wages = 0, 'mA Oct: daily wage 170 <= 176 => no employee ESI share; not PF-eligible', c.esi_employer::text);
  s := public.statutory_summary(ca, '2026-10-01');
  perform t.ok((s #>> '{pf,epf_wages}')::int = 37000 and (s #>> '{pf,ee_epf}')::int = 4440 and (s #>> '{pf,er_eps}')::int = 3082 and (s #>> '{pf,er_epf}')::int = 1358, 'PF totals', (s -> 'pf')::text);
  perform t.ok((s #>> '{pf,edli}')::int = 185 and (s #>> '{pf,admin}')::int = 185 and (s #>> '{pf,total}')::int = 9250, 'EDLI 0.5% and admin 0.5% on totals; PF grand total 9,250', (s #>> '{pf,total}'));
  perform t.ok((s #>> '{esi,wages}')::int = 17250 and (s #>> '{esi,employee}')::int = 98 and (s #>> '{esi,employer}')::int = 562 and (s #>> '{esi,total}')::int = 660 and (s #>> '{esi,members}')::int = 2, 'ESI totals 660', (s #>> '{esi,total}'));

  -- September 2026: ceiling changes on the 17th => day-weighted 19,666.67 (unverified method, flagged)
  select * into c from public.statutory_contributions(ca, '2026-09-01') where employee_id = a1;
  perform t.ok(c.pf_ceiling = 19666.67 and c.epf_wages = 19667 and 'CEILING_PRORATED' = any (c.warnings), 'Sept: ceiling prorated by days and flagged', c.pf_ceiling::text);
  update public.employee_payroll_info set eps_eligible = false where employee_id = a1;
  select * into c from public.statutory_contributions(ca, '2026-09-01') where employee_id = a1;
  perform t.ok(c.eps_wages = 0 and c.er_eps = 0 and c.er_epf = c.ee_epf and c.ee_epf = 2360, 'non-EPS member: employer 12% goes entirely to EPF', c.er_epf::text);
  update public.employee_payroll_info set eps_eligible = true where employee_id = a1;

  -- August 2026: old ceiling 15,000, half-day NCP rounding flagged
  select * into c from public.statutory_contributions(ca, '2026-08-01') where employee_id = a1;
  perform t.ok(c.pf_ceiling = 15000 and c.epf_wages = 15000 and c.ee_epf = 1800 and c.ncp_days = 1 and 'NCP_ROUNDED' = any (c.warnings), 'Aug: old 15,000 ceiling; 0.5 NCP rounds to 1 and is flagged', c.ncp_days::text);

  -- filings
  f := public.record_statutory_filing(ca, '2026-10-01', 'pf', '2026-11-12', ' TRRN123 ');
  perform t.ok(f.amount = 9250 and f.reference = 'TRRN123', 'PF filing records the total and trims the reference');
  f := public.record_statutory_filing(ca, '2026-10-01', 'pf', '2026-11-13', 'TRRN124');
  perform t.ok(f.reference = 'TRRN124' and (select count(*) from public.statutory_filings where kind = 'pf' and month = '2026-10-01') = 1, 'recording again updates the same filing');
  perform t.ok((public.statutory_summary(ca, '2026-10-01') #>> '{pf,filing,reference}') = 'TRRN124', 'summary shows the filing');
  perform t.throws(format($q$select public.record_statutory_filing(%L, '2026-10-01', 'tds', current_date)$q$, ca), 'INVALID_KIND', 'invalid kind refused');
  perform t.throws(format($q$select public.record_statutory_filing(%L, '2026-10-01', 'esi', '2026-09-30')$q$, ca), 'INVALID_DATE', 'filing date before the month refused');
  perform t.throws(format($q$select public.record_statutory_filing(%L, '2026-07-01', 'esi', '2026-08-10')$q$, ca), 'RUN_NOT_FINALIZED', 'filing needs a finalized run');
  perform t.throws(format($q$insert into public.statutory_filings (company_id, month, kind, filed_on, amount) values (%L, '2026-08-01', 'pf', current_date, 1)$q$, ca), 'permission denied', 'clients cannot write filings directly');
  perform t.logout();
  perform t.login(t.id('uA1'));
  perform t.ok((select count(*) from public.statutory_filings) = 0, 'employees cannot see filings');
  perform t.ok((select count(*) from public.statutory_params) >= 10, 'everyone can read statutory parameters');
  perform t.logout();
end $$;

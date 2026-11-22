-- Round 5b: tax slabs, rebate, marginal relief, declarations, projection, permissions.
do $$
declare ca uuid := t.id('cA'); a1 uuid := t.id('eA1'); a2 uuid := t.id('eA2'); mA uuid := t.id('eMA'); p jsonb; d public.tax_declarations; n int;
begin
  -- pure computation (superuser)
  perform t.ok((app.tax_breakdown('new', 400000, '2026-04-01') ->> 'total')::int = 0, 'new regime: nothing up to 4,00,000');
  perform t.ok((app.tax_breakdown('new', 1200000, '2026-04-01') ->> 'slab_tax')::numeric = 60000 and (app.tax_breakdown('new', 1200000, '2026-04-01') ->> 'total')::int = 0, 'new regime: 12,00,000 -> slab tax 60,000 fully rebated');
  perform t.ok((app.tax_breakdown('new', 1210000, '2026-04-01') ->> 'total')::int = 10400, 'new regime marginal relief: 12,10,000 pays only the excess 10,000 + 4% cess', (app.tax_breakdown('new', 1210000, '2026-04-01') ->> 'total'));
  perform t.ok((app.tax_breakdown('new', 1725000, '2026-04-01') ->> 'total')::int = 150800, 'new regime 17,25,000: 1,45,000 + cess = 1,50,800', (app.tax_breakdown('new', 1725000, '2026-04-01') ->> 'total'));
  perform t.ok((app.tax_breakdown('new', 3000000, '2026-04-01') ->> 'slab_tax')::numeric = 20000 + 40000 + 60000 + 80000 + 100000 + 180000 and (app.tax_breakdown('new', 3000000, '2026-04-01') ->> 'slab_tax')::numeric = 480000 - 0, 'new regime 30,00,000 slab tax is 4,80,000', (app.tax_breakdown('new', 3000000, '2026-04-01') ->> 'slab_tax'));
  perform t.ok((app.tax_breakdown('old', 500000, '2026-04-01') ->> 'total')::int = 0 and (app.tax_breakdown('old', 500001, '2026-04-01') ->> 'total')::int > 0, 'old regime: rebate up to 5,00,000 only');
  perform t.ok((app.tax_breakdown('old', 1145000, '2026-04-01') ->> 'total')::int = 162240, 'old regime 11,45,000: 12,500 + 1,00,000 + 43,500 + cess = 1,62,240', (app.tax_breakdown('old', 1145000, '2026-04-01') ->> 'total'));
  perform t.throws($q$select app.tax_breakdown('new', 100, '2025-04-01')$q$, 'NO_TAX_RULES', 'no rules before tax year 2026');

  update public.employee_payroll_info set pay_type = 'monthly', monthly_salary = 150000, daily_wage = null where employee_id = a1;
  -- employee saves own declaration
  perform t.login(t.id('uA1'));
  d := public.save_tax_declaration(a1, 2026, 'old', '{"sec_80c":200000,"sec_80ccd1b":50000,"sec_80d_self":30000,"sec_80d_parents":60000,"parents_senior":true,"hra_exemption":120000,"home_loan_interest":250000,"other_deductions":10000}');
  perform t.ok(d.regime = 'old' and d.sec_80c = 200000 and d.parents_senior, 'employee can save own declaration (caps applied at calculation, not at saving)');
  perform t.throws(format($q$select public.save_tax_declaration(%L, 2026, 'new')$q$, a2), 'FORBIDDEN', 'employee cannot save for a colleague');
  perform t.throws(format($q$select public.save_tax_declaration(%L, 2026, 'flat')$q$, a1), 'INVALID_REGIME', 'invalid regime refused');
  perform t.throws(format($q$select public.save_tax_declaration(%L, 2026, 'new', '{"sec_80c":-5}')$q$, a1), 'INVALID_AMOUNT', 'negative amount refused');
  perform t.throws(format($q$select public.save_tax_declaration(%L, 2020, 'new')$q$, a1), 'INVALID_TAX_YEAR', 'tax year before 2026 refused');
  perform t.ok((select count(*) from public.tax_declarations) = 1, 'employee sees only their own declaration');
  perform t.throws(format($q$insert into public.tax_declarations (company_id, employee_id, tax_year) values (%L, %L, 2027)$q$, ca, a1), 'permission denied', 'no direct writes');
  p := public.tax_projection(a1, 2026, '2026-04-10');
  perform t.ok((p ->> 'months_left')::int = 12 and (p ->> 'annual_gross')::numeric = 1800000 and (p ->> 'regime') = 'old', 'projection: 12 months x 1,50,000', (p ->> 'annual_gross'));
  perform t.ok((p #>> '{old,deductions}')::numeric = 655000 and (p #>> '{old,taxable}')::numeric = 1145000 and (p #>> '{old,total}')::int = 162240, 'old regime caps: 50k+150k+50k+25k+50k+200k+120k+10k = 6,55,000', (p #>> '{old,deductions}'));
  perform t.ok((p #>> '{new,taxable}')::numeric = 1725000 and (p #>> '{new,total}')::int = 150800, 'new regime computed alongside for comparison', (p #>> '{new,total}'));
  perform t.ok((p ->> 'monthly_tds')::int = 13520 and (p -> 'warnings') ? 'OLD_SLABS_UNVERIFIED', 'monthly TDS for the chosen (old) regime = 1,62,240 / 12 = 13,520, with unverified-slab warning', (p ->> 'monthly_tds'));
  perform t.throws(format($q$select public.tax_projection(%L, 2026)$q$, a2), 'FORBIDDEN', 'employee cannot project a colleague');
  perform t.throws(format($q$select * from public.tax_projection_all(%L, 2026)$q$, ca), 'FORBIDDEN', 'employee cannot list everyone');
  perform t.logout();

  perform t.login(t.id('uAA'));
  d := public.save_tax_declaration(a1, 2026, 'new', '{"prev_employer_income":0}');
  p := public.tax_projection(a1, 2026, '2026-04-10');
  perform t.ok((p ->> 'monthly_tds')::int = 12567 and not ((p -> 'warnings') ? 'OLD_SLABS_UNVERIFIED'), 'admin switches to new regime: 1,50,800 / 12 rounded up = 12,567', (p ->> 'monthly_tds'));
  perform t.logout(); update public.employee_payroll_info set monthly_salary = 100000 where employee_id = a1; perform t.login(t.id('uAA'));
  d := public.save_tax_declaration(a1, 2026, 'new', '{"prev_employer_income":85000,"prev_employer_tds":2000}');
  p := public.tax_projection(a1, 2026, '2026-04-10');
  perform t.ok((p #>> '{selected,taxable}')::numeric = 1210000 and (p #>> '{selected,total}')::int = 10400 and (p ->> 'monthly_tds')::int = 700, 'previous employer income/TDS: (10,400 - 2,000) / 12 = 700', (p ->> 'monthly_tds'));
  -- employee without declaration, daily wage estimate
  update public.employee_payroll_info set pay_type = 'daily', daily_wage = 650, monthly_salary = null where employee_id = a2;
  p := public.tax_projection(a2, 2026, '2026-04-10');
  perform t.ok((p -> 'warnings') ? 'NO_DECLARATION' and (p -> 'warnings') ? 'DAILY_ESTIMATE' and (p ->> 'monthly_pay_assumed')::numeric = 16900, 'daily wage employee without declaration: 26-day estimate and warnings', (p ->> 'monthly_pay_assumed'));
  -- earlier finalized payslips feed the projection (mA has one finalized Oct 2026 payslip of 4,250 from the statutory test)
  p := public.tax_projection(mA, 2026, '2026-11-15');
  perform t.ok((p ->> 'months_left')::int = 5 and (p ->> 'earned_before')::numeric = 4250 and (p ->> 'annual_gross')::numeric = 4250 + 4250 * 5, 'past payslips + average for months left (Nov..Mar = 5)', (p ->> 'annual_gross'));
  select count(*) into n from public.tax_projection_all(ca, 2026, '2026-04-10');
  perform t.ok(n >= 3, 'admin lists projections for every employee with pay info', n::text);
  perform t.ok((select count(*) from public.tax_declarations) >= 1, 'admin sees declarations');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.throws(format($q$select public.tax_projection(%L, 2026)$q$, a1), 'FORBIDDEN', 'other company admin cannot project');
  perform t.throws(format($q$select public.save_tax_declaration(%L, 2026, 'new')$q$, a1), 'FORBIDDEN', 'other company admin cannot save');
  perform t.ok((select count(*) from public.tax_declarations) = 0, 'other company sees no declarations');
  perform t.logout();
  perform t.login(t.id('uMA'));
  perform t.ok((select count(*) from public.tax_declarations) = 0, 'manager sees no declarations');
  perform t.logout();
end $$;

-- Round 5b: income-tax declarations, old/new regime computation and monthly TDS projection (advisory: payslips are NOT changed).
-- Rates/slabs are data in statutory_params / tax_slabs with a per-row `verified` flag.

create table public.tax_slabs (
  regime text not null check (regime in ('old', 'new')),
  effective_from date not null,
  lower numeric not null check (lower >= 0),            -- income above this amount is taxed at rate_pct (until the next slab)
  rate_pct numeric not null check (rate_pct between 0 and 100),
  source text not null, verified boolean not null default false,
  primary key (regime, effective_from, lower)
);
alter table public.tax_slabs enable row level security;
create policy tax_slabs_select on public.tax_slabs for select to authenticated using (true);
grant select on public.tax_slabs to authenticated;

insert into public.tax_slabs (regime, effective_from, lower, rate_pct, source, verified) values
  ('new', '2026-04-01', 0, 0, 'Income-tax Act 2025 s.202 (incometaxindia.gov.in)', true),
  ('new', '2026-04-01', 400000, 5, 'Income-tax Act 2025 s.202 (incometaxindia.gov.in)', true),
  ('new', '2026-04-01', 800000, 10, 'Income-tax Act 2025 s.202 (incometaxindia.gov.in)', true),
  ('new', '2026-04-01', 1200000, 15, 'Income-tax Act 2025 s.202 (incometaxindia.gov.in)', true),
  ('new', '2026-04-01', 1600000, 20, 'Income-tax Act 2025 s.202 (incometaxindia.gov.in)', true),
  ('new', '2026-04-01', 2000000, 25, 'Income-tax Act 2025 s.202 (incometaxindia.gov.in)', true),
  ('new', '2026-04-01', 2400000, 30, 'Income-tax Act 2025 s.202 (incometaxindia.gov.in)', true),
  ('old', '2026-04-01', 0, 0, 'incometax.gov.in AY 2026-27 slabs; NOT re-checked for tax year 2026-27', false),
  ('old', '2026-04-01', 250000, 5, 'incometax.gov.in AY 2026-27 slabs; NOT re-checked for tax year 2026-27', false),
  ('old', '2026-04-01', 500000, 20, 'incometax.gov.in AY 2026-27 slabs; NOT re-checked for tax year 2026-27', false),
  ('old', '2026-04-01', 1000000, 30, 'incometax.gov.in AY 2026-27 slabs; NOT re-checked for tax year 2026-27', false);

insert into public.statutory_params (key, effective_from, value, source, verified) values
  ('tax_std_new', '2026-04-01', 75000, 'Income-tax Act 2025 s.19 (standard deduction, s.202(1) regime)', true),
  ('tax_std_old', '2026-04-01', 50000, 'incometaxindia.gov.in salaried-employee benefits page', true),
  ('tax_rebate_new_limit', '2026-04-01', 1200000, 'incometaxindia.gov.in FAQ on computation of tax (s.156)', true),
  ('tax_rebate_new_max', '2026-04-01', 60000, 'incometaxindia.gov.in FAQ on computation of tax (s.156)', true),
  ('tax_rebate_old_limit', '2026-04-01', 500000, 'Income-tax Act 2025 s.156(1)', true),
  ('tax_rebate_old_max', '2026-04-01', 12500, 'Income-tax Act 2025 s.156(1)', true),
  ('tax_cess_pct', '2026-04-01', 4, 'Health and education cess; not re-checked on an official page', false),
  ('tax_cap_80c', '2026-04-01', 150000, 'Remembered limit (old section 80C/80CCE); not re-checked', false),
  ('tax_cap_80ccd1b', '2026-04-01', 50000, 'incometaxindia.gov.in (additional NPS deduction)', true),
  ('tax_cap_80d_self', '2026-04-01', 25000, 'Remembered limit (self/family, below 60); not re-checked', false),
  ('tax_cap_80d_parents', '2026-04-01', 25000, 'Remembered limit (parents below 60); not re-checked', false),
  ('tax_cap_80d_parents_senior', '2026-04-01', 50000, 'CBDT ITR validation rules AY 2026-27 (senior-citizen parents)', true),
  ('tax_cap_home_loan', '2026-04-01', 200000, 'Remembered limit (self-occupied property interest); not re-checked', false);

create table public.tax_declarations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  tax_year smallint not null check (tax_year between 2026 and 2100),     -- 2026 = 1 Apr 2026 .. 31 Mar 2027
  regime text not null default 'new' check (regime in ('old', 'new')),
  sec_80c numeric(12,2) not null default 0 check (sec_80c >= 0),
  sec_80ccd1b numeric(12,2) not null default 0 check (sec_80ccd1b >= 0),
  sec_80d_self numeric(12,2) not null default 0 check (sec_80d_self >= 0),
  sec_80d_parents numeric(12,2) not null default 0 check (sec_80d_parents >= 0),
  parents_senior boolean not null default false,
  hra_exemption numeric(12,2) not null default 0 check (hra_exemption >= 0),   -- annual exemption as worked out by the employee/CA; no basic/DA split is stored here
  home_loan_interest numeric(12,2) not null default 0 check (home_loan_interest >= 0),
  other_deductions numeric(12,2) not null default 0 check (other_deductions >= 0),
  prev_employer_income numeric(12,2) not null default 0 check (prev_employer_income >= 0),
  prev_employer_tds numeric(12,2) not null default 0 check (prev_employer_tds >= 0),
  updated_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (employee_id, tax_year),
  foreign key (employee_id, company_id) references public.employees (id, company_id)
);
create trigger tax_declarations_touch before update on public.tax_declarations for each row execute function app.touch_updated_at();
create trigger audit_tax_declarations after insert or update or delete on public.tax_declarations for each row execute function app.audit_row();
alter table public.tax_declarations enable row level security;
create policy tax_declarations_select on public.tax_declarations for select to authenticated
  using (app.is_company_admin(company_id) or employee_id = (select app.my_employee_id()));
grant select on public.tax_declarations to authenticated;

-- tax on an annual taxable income: slabs, then rebate (with marginal relief in the new regime), then cess
create function app.tax_breakdown(p_regime text, p_income numeric, p_on date) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from date; v_slab numeric; v_rebate numeric := 0; v_after numeric; v_cess numeric; v_lim numeric; v_max numeric; v_inc numeric := greatest(p_income, 0);
begin
  select max(effective_from) into v_from from public.tax_slabs where regime = p_regime and effective_from <= p_on;
  if v_from is null then raise exception 'NO_TAX_RULES'; end if;
  select coalesce(sum(greatest(0, least(v_inc, coalesce(s.nxt, v_inc)) - s.lower) * s.rate_pct / 100), 0) into v_slab
    from (select lower, rate_pct, lead(lower) over (order by lower) nxt from public.tax_slabs where regime = p_regime and effective_from = v_from) s;
  v_lim := app.sparam('tax_rebate_' || p_regime || '_limit', p_on); v_max := app.sparam('tax_rebate_' || p_regime || '_max', p_on);
  v_after := v_slab;
  if v_inc <= v_lim then v_rebate := least(v_slab, v_max); v_after := v_slab - v_rebate;
  elsif p_regime = 'new' and v_slab > v_inc - v_lim then v_after := v_inc - v_lim; v_rebate := v_slab - v_after; end if;   -- marginal relief
  v_cess := round(v_after * app.sparam('tax_cess_pct', p_on) / 100, 2);
  return jsonb_build_object('slab_tax', round(v_slab, 2), 'rebate', round(v_rebate, 2), 'tax_after_rebate', round(v_after, 2), 'cess', v_cess, 'total', round(v_after + v_cess));
end $$;

create function app.tax_scenario(p_regime text, p_gross numeric, d public.tax_declarations, p_on date) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ded numeric; v_std numeric; b jsonb; v_taxable numeric;
begin
  v_std := least(p_gross, app.sparam('tax_std_' || p_regime, p_on));
  v_ded := v_std;
  if p_regime = 'old' then
    v_ded := v_ded + least(coalesce(d.sec_80c, 0), app.sparam('tax_cap_80c', p_on)) + least(coalesce(d.sec_80ccd1b, 0), app.sparam('tax_cap_80ccd1b', p_on))
      + least(coalesce(d.sec_80d_self, 0), app.sparam('tax_cap_80d_self', p_on))
      + least(coalesce(d.sec_80d_parents, 0), app.sparam(case when coalesce(d.parents_senior, false) then 'tax_cap_80d_parents_senior' else 'tax_cap_80d_parents' end, p_on))
      + coalesce(d.hra_exemption, 0) + least(coalesce(d.home_loan_interest, 0), app.sparam('tax_cap_home_loan', p_on)) + coalesce(d.other_deductions, 0);
  end if;
  v_taxable := greatest(0, p_gross - v_ded);
  b := app.tax_breakdown(p_regime, v_taxable, p_on);
  return b || jsonb_build_object('regime', p_regime, 'deductions', round(v_ded, 2), 'taxable', round(v_taxable, 2));
end $$;

create function public.save_tax_declaration(p_employee uuid, p_tax_year int, p_regime text, p_values jsonb default '{}') returns public.tax_declarations
language plpgsql security definer set search_path = '' as $$
declare e public.employees; r public.tax_declarations; k text; v numeric;
  nums constant text[] := array['sec_80c','sec_80ccd1b','sec_80d_self','sec_80d_parents','hra_exemption','home_loan_interest','other_deductions','prev_employer_income','prev_employer_tds'];
  amt jsonb := '{}';
begin
  select * into e from public.employees where id = p_employee;
  if not found or not (app.is_company_admin(e.company_id) or e.id = (select app.my_employee_id())) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_regime not in ('old', 'new') then raise exception 'INVALID_REGIME'; end if;
  if p_tax_year is null or p_tax_year < 2026 or p_tax_year > (extract(year from current_date) + 1) then raise exception 'INVALID_TAX_YEAR'; end if;
  foreach k in array nums loop
    v := coalesce((p_values ->> k)::numeric, 0);
    if v < 0 or v > 100000000 then raise exception 'INVALID_AMOUNT'; end if;
    amt := amt || jsonb_build_object(k, round(v, 2));
  end loop;
  insert into public.tax_declarations (company_id, employee_id, tax_year, regime, sec_80c, sec_80ccd1b, sec_80d_self, sec_80d_parents, parents_senior, hra_exemption, home_loan_interest, other_deductions, prev_employer_income, prev_employer_tds, updated_by)
  values (e.company_id, e.id, p_tax_year, p_regime, (amt ->> 'sec_80c')::numeric, (amt ->> 'sec_80ccd1b')::numeric, (amt ->> 'sec_80d_self')::numeric, (amt ->> 'sec_80d_parents')::numeric,
    coalesce((p_values ->> 'parents_senior')::boolean, false), (amt ->> 'hra_exemption')::numeric, (amt ->> 'home_loan_interest')::numeric, (amt ->> 'other_deductions')::numeric,
    (amt ->> 'prev_employer_income')::numeric, (amt ->> 'prev_employer_tds')::numeric, (select auth.uid()))
  on conflict (employee_id, tax_year) do update set regime = excluded.regime, sec_80c = excluded.sec_80c, sec_80ccd1b = excluded.sec_80ccd1b, sec_80d_self = excluded.sec_80d_self,
    sec_80d_parents = excluded.sec_80d_parents, parents_senior = excluded.parents_senior, hra_exemption = excluded.hra_exemption, home_loan_interest = excluded.home_loan_interest,
    other_deductions = excluded.other_deductions, prev_employer_income = excluded.prev_employer_income, prev_employer_tds = excluded.prev_employer_tds, updated_by = excluded.updated_by
  returning * into r;
  return r;
end $$;

-- annual projection for one employee as of a month: finalized payslips before that month + the current monthly pay for the months left
create function public.tax_projection(p_employee uuid, p_tax_year int, p_as_of date default current_date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.employees; pi public.employee_payroll_info; d public.tax_declarations; v_start date := make_date(p_tax_year, 4, 1); v_end date := make_date(p_tax_year + 1, 3, 31);
  v_m date := greatest(date_trunc('month', p_as_of)::date, v_start); v_left int; v_past numeric; v_past_n int; v_month_pay numeric; v_gross numeric; v_new jsonb; v_old jsonb; v_sel jsonb;
  v_prev_tds numeric; v_tds numeric; w text[] := '{}';
begin
  select * into e from public.employees where id = p_employee;
  if not found or not (app.is_company_admin(e.company_id) or e.id = (select app.my_employee_id())) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_m > v_end then raise exception 'INVALID_TAX_YEAR'; end if;
  select * into pi from public.employee_payroll_info where employee_id = e.id;
  if not found then raise exception 'NO_PAY_INFO'; end if;
  select * into d from public.tax_declarations where employee_id = e.id and tax_year = p_tax_year;
  if not found then w := array_append(w, 'NO_DECLARATION'); d.regime := 'new'; end if;
  v_left := (extract(year from v_end) * 12 + extract(month from v_end) - extract(year from v_m) * 12 - extract(month from v_m) + 1)::int;
  select coalesce(sum(p.gross + p.bonus), 0), count(*) into v_past, v_past_n from public.payslips p where p.employee_id = e.id and p.finalized and p.month >= v_start and p.month < v_m;
  if pi.pay_type = 'monthly' then v_month_pay := pi.monthly_salary;
  elsif v_past_n > 0 then v_month_pay := v_past / v_past_n;
  else v_month_pay := pi.daily_wage * 26; w := array_append(w, 'DAILY_ESTIMATE'); end if;
  v_gross := v_past + v_month_pay * v_left + coalesce(d.prev_employer_income, 0);
  v_new := app.tax_scenario('new', v_gross, d, v_start); v_old := app.tax_scenario('old', v_gross, d, v_start);
  v_sel := case when coalesce(d.regime, 'new') = 'old' then v_old else v_new end;
  if coalesce(d.regime, 'new') = 'old' then w := array_append(w, 'OLD_SLABS_UNVERIFIED'); end if;
  if (v_sel ->> 'taxable')::numeric > 5000000 then w := array_append(w, 'SURCHARGE_NOT_MODELLED'); end if;
  v_prev_tds := coalesce(d.prev_employer_tds, 0);
  v_tds := 0;   -- payslips do not deduct TDS yet, so nothing has been deducted by this system
  return jsonb_build_object('tax_year', p_tax_year, 'as_of_month', v_m, 'months_left', v_left, 'regime', coalesce(d.regime, 'new'), 'earned_before', v_past, 'monthly_pay_assumed', round(v_month_pay, 2),
    'annual_gross', round(v_gross, 2), 'selected', v_sel, 'new', v_new, 'old', v_old, 'prev_employer_tds', v_prev_tds, 'tds_deducted_here', v_tds,
    'monthly_tds', greatest(0, ceil((((v_sel ->> 'total')::numeric) - v_prev_tds - v_tds) / v_left)), 'warnings', to_jsonb(w));
end $$;

create function public.tax_projection_all(p_company uuid, p_tax_year int, p_as_of date default current_date)
returns table (employee_id uuid, employee_code text, full_name text, projection jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare e record;
begin
  if not app.is_company_admin(p_company) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  for e in select em.id, em.employee_code, em.full_name from public.employees em join public.employee_payroll_info pi on pi.employee_id = em.id where em.company_id = p_company and em.is_active order by em.employee_code loop
    employee_id := e.id; employee_code := e.employee_code; full_name := e.full_name; projection := public.tax_projection(e.id, p_tax_year, p_as_of); return next;
  end loop;
end $$;

revoke all on function app.tax_breakdown(text, numeric, date), app.tax_scenario(text, numeric, public.tax_declarations, date), public.save_tax_declaration(uuid, int, text, jsonb),
  public.tax_projection(uuid, int, date), public.tax_projection_all(uuid, int, date) from public, anon;
grant execute on function app.tax_breakdown(text, numeric, date), app.tax_scenario(text, numeric, public.tax_declarations, date) to authenticated;
grant execute on function public.save_tax_declaration(uuid, int, text, jsonb), public.tax_projection(uuid, int, date), public.tax_projection_all(uuid, int, date) to authenticated;

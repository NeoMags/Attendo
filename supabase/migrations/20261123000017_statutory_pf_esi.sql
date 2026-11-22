-- Round 5a: statutory parameters, EPF/EPS/EDLI and ESI contribution computation from finalized payslips, filing records.
-- Parameter provenance is stored per row (`verified`, `source`). Rows with verified = false are NOT confirmed from an official source.

create table public.statutory_params (
  key text not null,
  effective_from date not null,
  value numeric not null,
  source text not null,
  verified boolean not null default false,
  primary key (key, effective_from)
);
alter table public.statutory_params enable row level security;
create policy statutory_params_select on public.statutory_params for select to authenticated using (true);
grant select on public.statutory_params to authenticated;

insert into public.statutory_params (key, effective_from, value, source, verified) values
  ('pf_wage_ceiling', '2014-09-01', 15000, 'PIB: first revised Sept 2014 (6,500 -> 15,000)', true),
  ('pf_wage_ceiling', '2026-09-17', 25000, 'Gazette S.O. 5109(E) dated 17-Sep-2026 (labour.gov.in)', true),
  ('pf_employee_pct', '2014-09-01', 12, 'Long-standing rate; restated in StaffNews FAQ on S.O. 5109(E) (third party)', false),
  ('pf_eps_pct', '2014-09-01', 8.33, 'Long-standing rate; StaffNews FAQ (third party)', false),
  ('pf_edli_pct', '2014-09-01', 0.5, 'StaffNews FAQ (third party)', false),
  ('pf_admin_pct', '2014-09-01', 0.5, 'StaffNews FAQ (third party)', false),
  ('esi_wage_ceiling', '2017-01-01', 21000, 'labour.gov.in FAQ on Labour Codes (as on 25-10-2026)', true),
  ('esi_employee_pct', '2019-07-01', 0.75, 'esic.gov.in contribution rates', true),
  ('esi_employer_pct', '2019-07-01', 3.25, 'esic.gov.in contribution rates', true),
  ('esi_employee_exempt_daily_wage', '2017-01-01', 176, 'Remembered rule (employee share nil up to Rs 176/day); not re-checked on an official page', false);

create function app.sparam(p_key text, p_on date) returns numeric language sql stable security definer set search_path = '' as $$
  select value from public.statutory_params where key = p_key and effective_from <= p_on order by effective_from desc limit 1 $$;

alter table public.employee_payroll_info add column eps_eligible boolean not null default true;
comment on column public.employee_payroll_info.eps_eligible is 'EPS (pension) member: wages did not exceed the PF wage ceiling at joining / at the ceiling change. Untick for employees above the ceiling at joining.';

create table public.statutory_filings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  month date not null check (month = date_trunc('month', month)::date),
  kind text not null check (kind in ('pf', 'esi')),
  filed_on date not null,
  reference text check (reference is null or length(reference) <= 60),   -- challan / TRRN / transaction no.
  amount numeric(12,2) not null check (amount >= 0),                     -- employee + employer total at the time of recording
  created_by uuid, created_at timestamptz not null default now(),
  unique (company_id, month, kind)
);
alter table public.statutory_filings enable row level security;
create policy statutory_filings_select on public.statutory_filings for select to authenticated using (app.is_company_admin(company_id));
grant select on public.statutory_filings to authenticated;
create trigger audit_statutory_filings after insert or update or delete on public.statutory_filings for each row execute function app.audit_row();

-- one row per employee with a finalized payslip for the month who is PF- and/or ESI-eligible
create function public.statutory_contributions(p_company uuid, p_month date)
returns table (
  employee_id uuid, employee_code text, full_name text, uan text, esi_ip_number text, gross numeric,
  pf_applies boolean, pf_ceiling numeric, epf_wages integer, eps_wages integer, edli_wages integer,
  ee_epf integer, er_eps integer, er_epf integer, ncp_days integer,
  esi_applies boolean, esi_wages integer, esi_days integer, esi_employee integer, esi_employer integer,
  warnings text[])
language plpgsql stable security definer set search_path = '' as $$
declare v_month date := date_trunc('month', p_month)::date; v_end date; v_pf_ceiling numeric; v_esi_ceiling numeric;
  v_ee numeric; v_eps numeric; v_esee numeric; v_eser numeric; v_exempt numeric; v_prorated boolean;
begin
  if not app.is_company_admin(p_company) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not exists (select 1 from public.payroll_runs r where r.company_id = p_company and r.month = v_month and r.status = 'finalized') then raise exception 'RUN_NOT_FINALIZED'; end if;
  v_end := (v_month + interval '1 month - 1 day')::date;
  -- the PF ceiling can change mid-month (17-Sep-2026): use the day-weighted ceiling. UNVERIFIED method (EPFO only says one return covers both periods).
  select round(avg(app.sparam('pf_wage_ceiling', d::date)), 2), min(app.sparam('pf_wage_ceiling', d::date)) <> max(app.sparam('pf_wage_ceiling', d::date))
    into v_pf_ceiling, v_prorated from generate_series(v_month, v_end, interval '1 day') d;
  v_esi_ceiling := app.sparam('esi_wage_ceiling', v_end);
  v_ee := app.sparam('pf_employee_pct', v_end); v_eps := app.sparam('pf_eps_pct', v_end);
  v_esee := app.sparam('esi_employee_pct', v_end); v_eser := app.sparam('esi_employer_pct', v_end); v_exempt := app.sparam('esi_employee_exempt_daily_wage', v_end);
  return query
  with base as (
    select e.id, e.employee_code, e.full_name, pi.pf_uan, pi.esi_ip_number, pi.pf_eligible, pi.esi_eligible, pi.eps_eligible, pi.pay_type, pi.monthly_salary,
           p.gross, p.working_days, p.present_days, p.holiday_days, p.paid_leave_days, p.unpaid_leave_days, p.absent_days
    from public.payslips p
    join public.employees e on e.id = p.employee_id
    join public.employee_payroll_info pi on pi.employee_id = e.id
    where p.company_id = p_company and p.month = v_month and p.finalized and (pi.pf_eligible or pi.esi_eligible)
  ), calc as (
    select b.*,
      b.pf_eligible as pf_on,
      case when b.pf_eligible then floor(least(b.gross, v_pf_ceiling) + 0.5)::int else 0 end as epfw,
      floor(b.unpaid_leave_days + b.absent_days + 0.5)::int as ncp,
      (b.esi_eligible and coalesce(case when b.pay_type = 'monthly' then b.monthly_salary else b.gross end, 0) <= v_esi_ceiling) as esi_on,
      floor(b.paid_leave_days + b.present_days + b.holiday_days + 0.5)::int as paid_days
    from base b
  )
  select c.id, c.employee_code, c.full_name, c.pf_uan, c.esi_ip_number, c.gross,
    c.pf_on, v_pf_ceiling, c.epfw,
    case when c.pf_on and c.eps_eligible then c.epfw else 0 end,
    c.epfw,
    floor(c.epfw * v_ee / 100 + 0.5)::int,
    case when c.pf_on and c.eps_eligible then floor(c.epfw * v_eps / 100 + 0.5)::int else 0 end,
    floor(c.epfw * v_ee / 100 + 0.5)::int - case when c.pf_on and c.eps_eligible then floor(c.epfw * v_eps / 100 + 0.5)::int else 0 end,
    case when c.pf_on then least(c.ncp, c.working_days) else 0 end,
    c.esi_on,
    case when c.esi_on then floor(c.gross + 0.5)::int else 0 end,
    case when c.esi_on then c.paid_days else 0 end,
    -- ESI: contributions rounded UP to the next rupee (UNVERIFIED on an official page); employee share nil when average daily wage <= the exemption limit
    case when c.esi_on and not (c.paid_days > 0 and c.gross / c.paid_days <= v_exempt) then ceil(round(c.gross * v_esee / 100, 4))::int else 0 end,
    case when c.esi_on then ceil(round(c.gross * v_eser / 100, 4))::int else 0 end,
    array_remove(array[
      case when c.pf_on and c.pf_uan is null then 'MISSING_UAN' end,
      case when c.esi_on and c.esi_ip_number is null then 'MISSING_ESI_IP' end,
      case when c.pf_on and v_prorated then 'CEILING_PRORATED' end,
      case when c.pf_on and (c.unpaid_leave_days + c.absent_days) <> floor(c.unpaid_leave_days + c.absent_days) then 'NCP_ROUNDED' end,
      case when c.esi_eligible and not c.esi_on then 'ESI_ABOVE_CEILING' end,
      case when c.esi_on and (c.paid_leave_days + c.present_days + c.holiday_days) <> floor(c.paid_leave_days + c.present_days + c.holiday_days) then 'ESI_DAYS_ROUNDED' end
    ], null)
  from calc c order by c.employee_code;
end $$;

-- establishment totals; EDLI and admin charges are computed on the total, rounded once (admin charge minimum, if any, is NOT applied - unverified)
create function public.statutory_summary(p_company uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date; r record; v_edli numeric := app.sparam('pf_edli_pct', v_end); v_adm numeric := app.sparam('pf_admin_pct', v_end);
  f_pf public.statutory_filings; f_esi public.statutory_filings;
begin
  select coalesce(sum(epf_wages), 0) epf_w, coalesce(sum(eps_wages), 0) eps_w, coalesce(sum(edli_wages), 0) edli_w, coalesce(sum(ee_epf), 0) ee, coalesce(sum(er_eps), 0) eps, coalesce(sum(er_epf), 0) er_epf,
         count(*) filter (where pf_applies) pf_n, coalesce(sum(esi_wages), 0) esi_w, coalesce(sum(esi_employee), 0) esi_ee, coalesce(sum(esi_employer), 0) esi_er, count(*) filter (where esi_applies) esi_n
    into r from public.statutory_contributions(p_company, p_month);
  select * into f_pf from public.statutory_filings where company_id = p_company and month = date_trunc('month', p_month)::date and kind = 'pf';
  select * into f_esi from public.statutory_filings where company_id = p_company and month = date_trunc('month', p_month)::date and kind = 'esi';
  return jsonb_build_object(
    'pf', jsonb_build_object('members', r.pf_n, 'epf_wages', r.epf_w, 'eps_wages', r.eps_w, 'edli_wages', r.edli_w, 'ee_epf', r.ee, 'er_eps', r.eps, 'er_epf', r.er_epf,
      'edli', floor(r.edli_w * v_edli / 100 + 0.5), 'admin', floor(r.epf_w * v_adm / 100 + 0.5),
      'total', r.ee + r.eps + r.er_epf + floor(r.edli_w * v_edli / 100 + 0.5) + floor(r.epf_w * v_adm / 100 + 0.5),
      'filing', case when f_pf.id is null then null else to_jsonb(f_pf) end),
    'esi', jsonb_build_object('members', r.esi_n, 'wages', r.esi_w, 'employee', r.esi_ee, 'employer', r.esi_er, 'total', r.esi_ee + r.esi_er,
      'filing', case when f_esi.id is null then null else to_jsonb(f_esi) end));
end $$;

create function public.record_statutory_filing(p_company uuid, p_month date, p_kind text, p_filed_on date, p_reference text default null) returns public.statutory_filings
language plpgsql security definer set search_path = '' as $$
declare v_amount numeric; s jsonb; f public.statutory_filings; v_month date := date_trunc('month', p_month)::date;
begin
  if not app.is_company_admin(p_company) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_kind not in ('pf', 'esi') then raise exception 'INVALID_KIND'; end if;
  if p_filed_on is null or p_filed_on > current_date + 1 or p_filed_on < v_month then raise exception 'INVALID_DATE'; end if;
  s := public.statutory_summary(p_company, v_month);                  -- raises RUN_NOT_FINALIZED
  v_amount := (s -> p_kind ->> 'total')::numeric;
  insert into public.statutory_filings (company_id, month, kind, filed_on, reference, amount, created_by)
    values (p_company, v_month, p_kind, p_filed_on, nullif(btrim(p_reference), ''), v_amount, (select auth.uid()))
    on conflict (company_id, month, kind) do update set filed_on = excluded.filed_on, reference = excluded.reference, amount = excluded.amount
    returning * into f;
  return f;
end $$;

revoke all on function public.statutory_contributions(uuid, date), public.statutory_summary(uuid, date), public.record_statutory_filing(uuid, date, text, date, text) from public, anon;
grant execute on function public.statutory_contributions(uuid, date), public.statutory_summary(uuid, date), public.record_statutory_filing(uuid, date, text, date, text) to authenticated;
revoke all on function app.sparam(text, date) from public, anon;
grant execute on function app.sparam(text, date) to authenticated;

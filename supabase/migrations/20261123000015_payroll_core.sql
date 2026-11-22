-- Attendo 015: payroll core. Per-day basis from attendance; advances with monthly recovery; company-employee ledger; payslip templates.
-- Pay rules (as agreed): working days = days of the month on the employee's shift working days (weekly off excluded; a shift decides which day is off).
--   monthly pay = salary / working days x (present + holiday + paid leave days); daily pay = wage x (present + paid leave days).
-- Everything that moves money is written only by the RPCs below (admin only). Managers have no access to payroll data.

create function app.is_company_admin(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select app.is_super_admin()) or (p_company = (select app.my_company_id()) and (select app.my_role()) = 'company_admin') $$;

create function app.notify_kind(p_company uuid, p_employee uuid, p_kind text, p_title text, p_body text, p_data jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (company_id, employee_id, kind, title, body, data) values (p_company, p_employee, p_kind, p_title, p_body, p_data) $$;

-- ---------------------------------------------------------------- holidays
create table public.company_holidays (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  holiday_date date not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (company_id, holiday_date)
);

-- ---------------------------------------------------------------- runs and payslips
create type public.payroll_status as enum ('draft', 'finalized');
create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  month date not null check (month = date_trunc('month', month)::date),
  status public.payroll_status not null default 'draft',
  created_by uuid, created_at timestamptz not null default now(),
  finalized_by uuid, finalized_at timestamptz,
  unique (company_id, month),
  unique (id, company_id)
);

create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  company_id uuid not null,
  employee_id uuid not null,
  month date not null,
  pay_type text not null check (pay_type in ('monthly', 'daily')),
  monthly_salary numeric(12,2), daily_wage numeric(12,2),
  working_days integer not null check (working_days >= 0),
  present_days numeric(5,1) not null, holiday_days numeric(5,1) not null, paid_leave_days numeric(5,1) not null,
  unpaid_leave_days numeric(5,1) not null, absent_days numeric(5,1) not null,
  gross numeric(12,2) not null check (gross >= 0),
  bonus numeric(12,2) not null default 0 check (bonus >= 0),
  other_deduction numeric(12,2) not null default 0 check (other_deduction >= 0),
  skip_advance boolean not null default false,
  advance_deduction numeric(12,2) not null default 0 check (advance_deduction >= 0),
  net numeric(12,2) not null check (net >= 0),
  adjustment_note text check (adjustment_note is null or length(adjustment_note) <= 300),
  finalized boolean not null default false,
  paid_on date, payment_mode text check (payment_mode in ('cash', 'bank', 'upi', 'cheque', 'other')),
  created_at timestamptz not null default now(),
  unique (run_id, employee_id),
  unique (id, company_id),
  foreign key (run_id, company_id) references public.payroll_runs (id, company_id) on delete cascade,
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  check (net = gross + bonus - other_deduction - advance_deduction),
  check ((paid_on is null) = (payment_mode is null))
);
create index payslips_employee on public.payslips (employee_id, month desc);

-- ---------------------------------------------------------------- advances and ledger
create table public.employee_advances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  amount numeric(12,2) not null check (amount > 0 and amount <= 10000000),
  given_on date not null,
  reason text check (reason is null or length(reason) <= 300),
  monthly_deduction numeric(12,2) check (monthly_deduction is null or (monthly_deduction > 0 and monthly_deduction <= amount)),
  created_by uuid, created_at timestamptz not null default now(),
  unique (id, company_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id)
);
create index advances_employee on public.employee_advances (employee_id, given_on);

create table public.advance_recoveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  advance_id uuid not null,
  payslip_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (advance_id, payslip_id),
  foreign key (advance_id, company_id) references public.employee_advances (id, company_id),
  foreign key (payslip_id, company_id) references public.payslips (id, company_id)
);

create type public.ledger_kind as enum ('advance_given', 'advance_recovered', 'salary_paid');
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  entry_date date not null,
  kind public.ledger_kind not null,
  amount numeric(12,2) not null check (amount > 0),
  direction text not null check (direction in ('to_employee', 'from_employee')),   -- cash/bank paid to the employee vs recovered from salary
  ref_id uuid,
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  foreign key (employee_id, company_id) references public.employees (id, company_id)
);
create index ledger_employee on public.ledger_entries (employee_id, entry_date desc, created_at desc);

-- remaining balance per advance (SECURITY INVOKER: RLS decides who sees which rows)
create view public.advance_balances with (security_invoker = true) as
  select a.id, a.company_id, a.employee_id, a.amount, a.given_on, a.reason, a.monthly_deduction,
         coalesce((select sum(r.amount) from public.advance_recoveries r where r.advance_id = a.id), 0)::numeric(12,2) as recovered,
         (a.amount - coalesce((select sum(r.amount) from public.advance_recoveries r where r.advance_id = a.id), 0))::numeric(12,2) as remaining
  from public.employee_advances a;
grant select on public.advance_balances to authenticated;

-- ---------------------------------------------------------------- payslip templates (managers may draft them)
create table public.payslip_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  name text not null check (length(btrim(name)) between 1 and 80),
  header_text text check (header_text is null or length(header_text) <= 200),
  footer_text text check (footer_text is null or length(footer_text) <= 500),
  show_attendance boolean not null default true,
  show_bank boolean not null default false,
  accent text not null default '#0f172a' check (accent ~ '^#[0-9a-fA-F]{6}$'),
  is_default boolean not null default false,
  created_by uuid, created_at timestamptz not null default now(),
  unique (company_id, name)
);
create unique index payslip_templates_one_default on public.payslip_templates (company_id) where is_default;

create trigger audit_company_holidays after insert or update or delete on public.company_holidays for each row execute function app.audit_row();
create trigger audit_payroll_runs after insert or update or delete on public.payroll_runs for each row execute function app.audit_row();
create trigger audit_payslips after insert or update or delete on public.payslips for each row execute function app.audit_row();
create trigger audit_employee_advances after insert or update or delete on public.employee_advances for each row execute function app.audit_row();
create trigger audit_payslip_templates after insert or update or delete on public.payslip_templates for each row execute function app.audit_row();

-- ---------------------------------------------------------------- RLS
alter table public.company_holidays enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payslips enable row level security;
alter table public.employee_advances enable row level security;
alter table public.advance_recoveries enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.payslip_templates enable row level security;

create policy holidays_select on public.company_holidays for select to authenticated using ((select app.is_super_admin()) or company_id = (select app.my_company_id()));
create policy holidays_insert on public.company_holidays for insert to authenticated with check (app.is_company_admin(company_id));
create policy holidays_update on public.company_holidays for update to authenticated using (app.is_company_admin(company_id)) with check (app.is_company_admin(company_id));
create policy holidays_delete on public.company_holidays for delete to authenticated using (app.is_company_admin(company_id));

create policy runs_select on public.payroll_runs for select to authenticated using (app.is_company_admin(company_id));
create policy payslips_select on public.payslips for select to authenticated
  using (app.is_company_admin(company_id) or (finalized and employee_id = (select app.my_employee_id())));
create policy advances_select on public.employee_advances for select to authenticated
  using (app.is_company_admin(company_id) or employee_id = (select app.my_employee_id()));
create policy recoveries_select on public.advance_recoveries for select to authenticated using (app.is_company_admin(company_id));
create policy ledger_select on public.ledger_entries for select to authenticated
  using (app.is_company_admin(company_id) or employee_id = (select app.my_employee_id()));

create policy templates_select on public.payslip_templates for select to authenticated using ((select app.is_super_admin()) or company_id = (select app.my_company_id()));
create function app.can_edit_templates(p_company uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select (select app.is_super_admin()) or (p_company = (select app.my_company_id()) and (select app.my_role()) in ('company_admin', 'manager')) $$;
create policy templates_insert on public.payslip_templates for insert to authenticated with check (app.can_edit_templates(company_id));
create policy templates_update on public.payslip_templates for update to authenticated using (app.can_edit_templates(company_id)) with check (app.can_edit_templates(company_id));
create policy templates_delete on public.payslip_templates for delete to authenticated using (app.can_edit_templates(company_id));

grant select on public.payroll_runs, public.payslips, public.employee_advances, public.advance_recoveries, public.ledger_entries to authenticated;
grant select, insert, update, delete on public.company_holidays, public.payslip_templates to authenticated;

-- ---------------------------------------------------------------- calculation
create function app.payroll_days(p_employee uuid, p_month date)
returns table (working_days integer, present_days numeric, holiday_days numeric, paid_leave_days numeric, unpaid_leave_days numeric, absent_days numeric)
language sql stable security definer set search_path = '' as $$
  with e as (
    select e.company_id, e.joined_on, coalesce(s.working_days, '{1,2,3,4,5,6}'::smallint[]) as wd
    from public.employees e left join public.shifts s on s.id = e.shift_id and s.company_id = e.company_id where e.id = p_employee),
  rng as (select p_month as m0, (p_month + interval '1 month - 1 day')::date as m1),
  days as (
    select g::date as d from e, rng, generate_series(rng.m0, rng.m1, interval '1 day') g
    where extract(isodow from g)::smallint = any (e.wd) and (e.joined_on is null or g::date >= e.joined_on)),
  pres as (select distinct a.work_date as d from public.attendance a, rng where a.employee_id = p_employee and a.work_date between rng.m0 and rng.m1),
  hol as (select h.holiday_date as d from public.company_holidays h, e, rng where h.company_id = e.company_id and h.holiday_date between rng.m0 and rng.m1),
  lv as (
    select g::date as d, case when r.is_half_day then 0.5 else 1 end as qty, coalesce(r.is_paid, true) as paid
    from public.leave_requests r, rng, generate_series(greatest(r.start_date, rng.m0), least(r.end_date, rng.m1), interval '1 day') g
    where r.employee_id = p_employee and r.status = 'approved')
  select count(*)::integer,
    (count(*) filter (where p.d is not null))::numeric,
    (count(*) filter (where p.d is null and h.d is not null))::numeric,
    coalesce(sum(l.qty) filter (where p.d is null and h.d is null and l.paid), 0),
    coalesce(sum(l.qty) filter (where p.d is null and h.d is null and not l.paid), 0),
    coalesce(sum(1 - coalesce(l.qty, 0)) filter (where p.d is null and h.d is null), 0)
  from days dd left join pres p on p.d = dd.d left join hol h on h.d = dd.d left join lv l on l.d = dd.d $$;

-- Deduction planned for this month: each open advance recovers min(remaining, monthly_deduction or all), oldest first, capped by what can be paid.
create function app.plan_advance_deduction(p_employee uuid, p_cap numeric) returns numeric
language sql stable security definer set search_path = '' as $$
  select least(coalesce(sum(least(b.remaining, coalesce(b.monthly_deduction, b.remaining))), 0), greatest(p_cap, 0))::numeric(12,2)
  from public.advance_balances b where b.employee_id = p_employee and b.remaining > 0 $$;
-- NOTE: advance_balances is security invoker; this definer function runs as the owner, so it sees every row for the given employee only.

-- ---------------------------------------------------------------- RPCs
create function public.generate_payroll(p_company uuid, p_month date) returns public.payroll_runs
language plpgsql security definer set search_path = '' as $$
declare v_month date := date_trunc('month', p_month)::date; v_today date; run public.payroll_runs; e record; d record; v_gross numeric(12,2); ps public.payslips;
begin
  if not app.is_company_admin(p_company) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select (now() at time zone c.timezone)::date into v_today from public.companies c where c.id = p_company;
  if v_today is null then raise exception 'COMPANY_NOT_FOUND'; end if;
  if v_month > date_trunc('month', v_today)::date then raise exception 'MONTH_IN_FUTURE'; end if;
  insert into public.payroll_runs (company_id, month, created_by) values (p_company, v_month, (select auth.uid()))
    on conflict (company_id, month) do nothing;
  select * into run from public.payroll_runs where company_id = p_company and month = v_month for update;
  if run.status = 'finalized' then raise exception 'RUN_FINALIZED'; end if;
  for e in
    select em.id, pi.pay_type, pi.monthly_salary, pi.daily_wage from public.employees em
    join public.employee_payroll_info pi on pi.employee_id = em.id
    where em.company_id = p_company and em.is_active and (em.joined_on is null or em.joined_on <= (v_month + interval '1 month - 1 day')::date)
  loop
    select * into d from app.payroll_days(e.id, v_month);
    v_gross := case when e.pay_type = 'monthly'
        then case when d.working_days = 0 then 0 else round(e.monthly_salary * (d.present_days + d.holiday_days + d.paid_leave_days) / d.working_days, 2) end
        else round(e.daily_wage * (d.present_days + d.paid_leave_days), 2) end;
    select * into ps from public.payslips where run_id = run.id and employee_id = e.id;
    if found then
      update public.payslips set pay_type = e.pay_type, monthly_salary = e.monthly_salary, daily_wage = e.daily_wage, working_days = d.working_days,
        present_days = d.present_days, holiday_days = d.holiday_days, paid_leave_days = d.paid_leave_days, unpaid_leave_days = d.unpaid_leave_days,
        absent_days = d.absent_days, gross = v_gross, advance_deduction = 0, net = v_gross + bonus - other_deduction where id = ps.id;
    else
      insert into public.payslips (run_id, company_id, employee_id, month, pay_type, monthly_salary, daily_wage, working_days, present_days, holiday_days,
        paid_leave_days, unpaid_leave_days, absent_days, gross, net)
      values (run.id, p_company, e.id, v_month, e.pay_type, e.monthly_salary, e.daily_wage, d.working_days, d.present_days, d.holiday_days,
        d.paid_leave_days, d.unpaid_leave_days, d.absent_days, v_gross, v_gross);
    end if;
    perform app.payslip_settle(p.id) from public.payslips p where p.run_id = run.id and p.employee_id = e.id;
  end loop;
  return run;
end $$;

-- recompute advance deduction and net for one draft payslip
create function app.payslip_settle(p_payslip uuid) returns void language plpgsql security definer set search_path = '' as $$
declare p public.payslips; v_adv numeric(12,2);
begin
  select * into p from public.payslips where id = p_payslip;
  v_adv := case when p.skip_advance then 0 else app.plan_advance_deduction(p.employee_id, p.gross + p.bonus - p.other_deduction) end;
  update public.payslips set advance_deduction = v_adv, net = gross + bonus - other_deduction - v_adv where id = p.id;
end $$;

create function public.set_payslip_adjustment(p_payslip uuid, p_bonus numeric, p_other numeric, p_note text default null, p_skip_advance boolean default false)
returns public.payslips language plpgsql security definer set search_path = '' as $$
declare p public.payslips; v_status public.payroll_status;
begin
  select * into p from public.payslips where id = p_payslip for update;
  if not found then raise exception 'PAYSLIP_NOT_FOUND'; end if;
  if not app.is_company_admin(p.company_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p.finalized then raise exception 'RUN_FINALIZED'; end if;
  if coalesce(p_bonus, 0) < 0 or coalesce(p_other, 0) < 0 then raise exception 'INVALID_AMOUNT'; end if;
  if coalesce(p_other, 0) > p.gross + coalesce(p_bonus, 0) then raise exception 'DEDUCTION_EXCEEDS_PAY'; end if;
  update public.payslips set bonus = round(coalesce(p_bonus, 0), 2), other_deduction = round(coalesce(p_other, 0), 2),
    adjustment_note = nullif(btrim(p_note), ''), skip_advance = coalesce(p_skip_advance, false),
    advance_deduction = 0, net = gross + round(coalesce(p_bonus, 0), 2) - round(coalesce(p_other, 0), 2) where id = p.id;
  perform app.payslip_settle(p.id);
  select * into p from public.payslips where id = p_payslip;
  return p;
end $$;

create function public.finalize_payroll(p_run uuid) returns public.payroll_runs
language plpgsql security definer set search_path = '' as $$
declare run public.payroll_runs; p public.payslips; a record; v_left numeric(12,2); v_take numeric(12,2); v_today date;
begin
  select * into run from public.payroll_runs where id = p_run for update;
  if not found then raise exception 'RUN_NOT_FOUND'; end if;
  if not app.is_company_admin(run.company_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if run.status = 'finalized' then raise exception 'RUN_FINALIZED'; end if;
  if not exists (select 1 from public.payslips where run_id = run.id) then raise exception 'NO_PAYSLIPS'; end if;
  select (now() at time zone c.timezone)::date into v_today from public.companies c where c.id = run.company_id;
  for p in select * from public.payslips where run_id = run.id order by employee_id for update loop
    perform app.payslip_settle(p.id);                       -- pick up any advance given since the draft was made
    select * into p from public.payslips where id = p.id;
    v_left := p.advance_deduction;
    if v_left > 0 then
      for a in select b.id, b.remaining, b.monthly_deduction from public.advance_balances b where b.employee_id = p.employee_id and b.remaining > 0 order by b.given_on, b.id loop
        exit when v_left <= 0;
        v_take := least(v_left, a.remaining, coalesce(a.monthly_deduction, a.remaining));
        insert into public.advance_recoveries (company_id, advance_id, payslip_id, amount) values (p.company_id, a.id, p.id, v_take);
        v_left := v_left - v_take;
      end loop;
      if v_left > 0 then raise exception 'ADVANCE_CHANGED'; end if;
      insert into public.ledger_entries (company_id, employee_id, entry_date, kind, amount, direction, ref_id, note)
        values (p.company_id, p.employee_id, v_today, 'advance_recovered', p.advance_deduction, 'from_employee', p.id, 'Recovered from ' || to_char(p.month, 'Mon YYYY') || ' salary');
    end if;
    update public.payslips set finalized = true where id = p.id;
    perform app.notify_kind(p.company_id, p.employee_id, 'payslip', 'Payslip ready', to_char(p.month, 'Mon YYYY'), jsonb_build_object('payslip_id', p.id));
  end loop;
  update public.payroll_runs set status = 'finalized', finalized_by = (select auth.uid()), finalized_at = now() where id = run.id returning * into run;
  return run;
end $$;

create function public.mark_payslip_paid(p_payslip uuid, p_paid_on date, p_mode text) returns public.payslips
language plpgsql security definer set search_path = '' as $$
declare p public.payslips;
begin
  select * into p from public.payslips where id = p_payslip for update;
  if not found then raise exception 'PAYSLIP_NOT_FOUND'; end if;
  if not app.is_company_admin(p.company_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not p.finalized then raise exception 'RUN_NOT_FINALIZED'; end if;
  if p.paid_on is not null then raise exception 'ALREADY_PAID'; end if;
  if p_mode is null or p_mode not in ('cash', 'bank', 'upi', 'cheque', 'other') then raise exception 'INVALID_MODE'; end if;
  if p_paid_on is null or p_paid_on > current_date + 1 then raise exception 'INVALID_DATE'; end if;
  update public.payslips set paid_on = p_paid_on, payment_mode = p_mode where id = p.id returning * into p;
  if p.net > 0 then
    insert into public.ledger_entries (company_id, employee_id, entry_date, kind, amount, direction, ref_id, note)
      values (p.company_id, p.employee_id, p_paid_on, 'salary_paid', p.net, 'to_employee', p.id, 'Salary ' || to_char(p.month, 'Mon YYYY') || ' (' || p_mode || ')');
  end if;
  return p;
end $$;

create function public.give_advance(p_company uuid, p_employee uuid, p_amount numeric, p_given_on date, p_reason text default null, p_monthly_deduction numeric default null)
returns public.employee_advances language plpgsql security definer set search_path = '' as $$
declare r public.employee_advances;
begin
  if not app.is_company_admin(p_company) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not exists (select 1 from public.employees e where e.id = p_employee and e.company_id = p_company and e.is_active) then raise exception 'EMPLOYEE_NOT_FOUND'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then raise exception 'INVALID_AMOUNT'; end if;
  if p_given_on is null or p_given_on > current_date + 1 then raise exception 'INVALID_DATE'; end if;
  if p_monthly_deduction is not null and (p_monthly_deduction <= 0 or p_monthly_deduction > p_amount) then raise exception 'INVALID_INSTALLMENT'; end if;
  insert into public.employee_advances (company_id, employee_id, amount, given_on, reason, monthly_deduction, created_by)
    values (p_company, p_employee, round(p_amount, 2), p_given_on, nullif(btrim(p_reason), ''), round(p_monthly_deduction, 2), (select auth.uid())) returning * into r;
  insert into public.ledger_entries (company_id, employee_id, entry_date, kind, amount, direction, ref_id, note)
    values (p_company, p_employee, p_given_on, 'advance_given', r.amount, 'to_employee', r.id, coalesce(r.reason, 'Advance'));
  perform app.notify_kind(p_company, p_employee, 'advance', 'Advance recorded', r.amount::text, jsonb_build_object('advance_id', r.id));
  return r;
end $$;

revoke all on function public.generate_payroll(uuid, date), public.set_payslip_adjustment(uuid, numeric, numeric, text, boolean), public.finalize_payroll(uuid),
  public.mark_payslip_paid(uuid, date, text), public.give_advance(uuid, uuid, numeric, date, text, numeric) from public, anon;
grant execute on function public.generate_payroll(uuid, date), public.set_payslip_adjustment(uuid, numeric, numeric, text, boolean), public.finalize_payroll(uuid),
  public.mark_payslip_paid(uuid, date, text), public.give_advance(uuid, uuid, numeric, date, text, numeric) to authenticated;

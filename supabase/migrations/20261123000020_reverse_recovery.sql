-- Reverse an advance recovery taken on a finalized payslip that has NOT been paid yet:
-- the deduction is removed from the payslip (net goes back up), the advance balance is restored and is recovered again by a later payroll.
alter type public.ledger_kind add value if not exists 'advance_reversed';
alter table public.advance_recoveries
  add column reversed_at timestamptz, add column reversed_by uuid,
  add column reverse_reason text check (reverse_reason is null or length(reverse_reason) <= 300);

create or replace view public.advance_balances with (security_invoker = true) as
  select a.id, a.company_id, a.employee_id, a.amount, a.given_on, a.reason, a.monthly_deduction,
         coalesce((select sum(r.amount) from public.advance_recoveries r where r.advance_id = a.id and r.reversed_at is null), 0)::numeric(12,2) as recovered,
         (case when a.voided_at is not null then 0
               else a.amount - coalesce((select sum(r.amount) from public.advance_recoveries r where r.advance_id = a.id and r.reversed_at is null), 0) end)::numeric(12,2) as remaining,
         (a.voided_at is not null) as voided, a.void_reason
  from public.employee_advances a;

create function public.reverse_advance_recovery(p_payslip uuid, p_reason text default null) returns public.payslips
language plpgsql security definer set search_path = '' as $$
declare p public.payslips; v_amt numeric(12,2); v_today date; v_note text;
begin
  select * into p from public.payslips where id = p_payslip for update;
  if not found then raise exception 'PAYSLIP_NOT_FOUND'; end if;
  if not app.is_company_admin(p.company_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not p.finalized then raise exception 'RUN_NOT_FINALIZED'; end if;
  if p.paid_on is not null then raise exception 'ALREADY_PAID'; end if;       -- salary already paid net of the deduction: reversing would charge the employee twice
  select coalesce(sum(r.amount), 0) into v_amt from public.advance_recoveries r where r.payslip_id = p.id and r.reversed_at is null;
  if v_amt <= 0 then raise exception 'NOTHING_TO_REVERSE'; end if;
  select (now() at time zone c.timezone)::date into v_today from public.companies c where c.id = p.company_id;
  update public.advance_recoveries set reversed_at = now(), reversed_by = (select auth.uid()), reverse_reason = nullif(btrim(p_reason), '')
    where payslip_id = p.id and reversed_at is null;
  v_note := left(coalesce(p.adjustment_note || '; ', '') || 'Advance recovery of ' || v_amt::text || ' reversed', 300);
  update public.payslips set advance_deduction = 0, net = gross + bonus - other_deduction, adjustment_note = v_note where id = p.id returning * into p;
  insert into public.ledger_entries (company_id, employee_id, entry_date, kind, amount, direction, ref_id, note)
    values (p.company_id, p.employee_id, v_today, 'advance_reversed', v_amt, 'waived', p.id,
            'Recovery reversed for ' || to_char(p.month, 'Mon YYYY') || coalesce(': ' || nullif(btrim(p_reason), ''), ''));
  perform app.notify_kind(p.company_id, p.employee_id, 'advance', 'Advance recovery reversed', v_amt::text, jsonb_build_object('payslip_id', p.id));
  return p;
end $$;
revoke all on function public.reverse_advance_recovery(uuid, text) from public, anon;
grant execute on function public.reverse_advance_recovery(uuid, text) to authenticated;

-- Fix: advance_balances is security_invoker, so employees must be able to see the recoveries of their own advances or their "remaining" shows the full amount.
drop policy recoveries_select on public.advance_recoveries;
create policy recoveries_select on public.advance_recoveries for select to authenticated
  using (app.is_company_admin(company_id) or exists (select 1 from public.employee_advances a where a.id = advance_id and a.employee_id = (select app.my_employee_id())));

-- Attendo 013: the approver decides whether an approved leave is paid. Default = the leave type's is_paid.
-- Weekly off needs no schema change: shifts.working_days already defines it (untick a day = weekly off, e.g. Monday).
alter table public.leave_requests add column is_paid boolean;   -- null until finally approved

drop function public.decide_leave(uuid, boolean, text);
create function public.decide_leave(p_request_id uuid, p_approve boolean, p_note text default null, p_paid boolean default null)
returns public.leave_requests language plpgsql security definer set search_path = '' as $$
declare r public.leave_requests; v_is_admin boolean; v_is_mgr boolean; v_note text := nullif(btrim(p_note), '');
begin
  select * into r from public.leave_requests where id = p_request_id for update;
  if not found then raise exception 'LEAVE_NOT_FOUND'; end if;
  v_is_admin := (select app.is_super_admin()) or ((select app.my_role()) = 'company_admin' and r.company_id = (select app.my_company_id()));
  v_is_mgr := (select app.my_role()) = 'manager' and r.employee_id in (select app.managed_employee_ids());
  if not (v_is_admin or v_is_mgr) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if r.employee_id = (select app.my_employee_id()) then raise exception 'SELF_APPROVAL_NOT_ALLOWED' using errcode = '42501'; end if;
  if p_approve is null then raise exception 'INVALID_DECISION'; end if;
  if not p_approve and (v_note is null or length(v_note) < 3) then raise exception 'NOTE_REQUIRED'; end if;
  if v_note is not null and length(v_note) > 300 then raise exception 'NOTE_TOO_LONG'; end if;
  if v_is_admin then
    if r.status not in ('pending', 'manager_approved') then raise exception 'INVALID_STATE'; end if;
    update public.leave_requests set status = case when p_approve then 'approved' else 'rejected' end::public.leave_status,
      decided_by = (select auth.uid()), decided_at = now(), decision_note = v_note,
      is_paid = case when p_approve then coalesce(p_paid, (select lt.is_paid from public.leave_types lt where lt.id = leave_type_id)) end
      where id = r.id returning * into r;
  else
    if r.status <> 'pending' then raise exception 'INVALID_STATE'; end if;
    if p_approve then
      update public.leave_requests set status = 'manager_approved', manager_decided_by = (select auth.uid()), manager_decided_at = now(), manager_note = v_note
        where id = r.id returning * into r;
    else
      update public.leave_requests set status = 'rejected', manager_decided_by = (select auth.uid()), manager_decided_at = now(), manager_note = v_note,
        decided_by = (select auth.uid()), decided_at = now(), decision_note = v_note where id = r.id returning * into r;
    end if;
  end if;
  perform app.notify_leave(r.company_id, r.employee_id,
    case r.status when 'approved' then 'Leave approved' when 'rejected' then 'Leave rejected' else 'Leave approved by manager' end,
    r.start_date || ' to ' || r.end_date, r.id);
  return r;
end $$;
revoke all on function public.decide_leave(uuid, boolean, text, boolean) from public, anon;
grant execute on function public.decide_leave(uuid, boolean, text, boolean) to authenticated;

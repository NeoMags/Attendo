-- Leave management: types, apply/decide/cancel rules, overlap, balances, RLS visibility, notifications, audit.
do $$
declare ca uuid := t.id('cA'); cb uuid := t.id('cB');
  mon date := (date_trunc('week', current_date + 14))::date;   -- a Monday two weeks ahead
  r public.leave_requests; r2 public.leave_requests; r3 public.leave_requests; ty_cas uuid; ty_sick uuid; ty_off uuid; ty_b uuid; n bigint; rec record;
begin
  -- ---- leave types
  perform t.login(t.id('uAA'));
  insert into public.leave_types (company_id, name, annual_quota_days) values (ca, 'Casual', 5) returning id into ty_cas;
  insert into public.leave_types (company_id, name, annual_quota_days) values (ca, 'Sick', null) returning id into ty_sick;
  insert into public.leave_types (company_id, name, annual_quota_days, is_active) values (ca, 'Retired', 10, false) returning id into ty_off;
  perform t.ok(ty_cas is not null, 'company admin can create leave types');
  perform t.throws(format($q$insert into public.leave_types (company_id, name) values (%L, 'X')$q$, cb), 'row-level security', 'company admin cannot create leave type in another company');
  perform t.throws(format($q$insert into public.leave_types (company_id, name, annual_quota_days) values (%L, 'Neg', -1)$q$, ca), 'check', 'negative quota rejected');
  perform t.logout();
  perform t.login(t.id('uAB'));
  insert into public.leave_types (company_id, name, annual_quota_days) values (cb, 'Casual', 12) returning id into ty_b;
  perform t.ok((select count(*) from public.leave_types) = 1, 'company admin B sees only own company leave types');
  perform t.logout();
  perform t.login(t.id('uA1'));
  perform t.ok((select count(*) from public.leave_types) = 3, 'employee sees own company leave types');
  perform t.throws(format($q$insert into public.leave_types (company_id, name) values (%L, 'Mine')$q$, ca), 'row-level security', 'employee cannot create leave type');
  perform t.logout();

  -- ---- apply
  perform t.login(t.id('uA1'));
  r := public.apply_leave(ty_cas, mon, mon + 2, false, 'family event');
  perform t.ok(r.status = 'pending' and r.days = 3 and r.employee_id = t.id('eA1'), 'employee applies: pending, 3 working days (Mon-Wed)');
  insert into t.ids values ('lv1', r.id);
  perform t.throws(format($q$select public.apply_leave(%L, %L, %L)$q$, ty_sick, mon + 1, mon + 1), 'LEAVE_OVERLAP', 'overlapping request rejected (any type)');
  r2 := public.apply_leave(ty_cas, mon + 3, mon + 6, false, null);   -- Thu, Fri, Sat, Sun -> 2 working days (shift Mon-Fri)
  perform t.ok(r2.days = 2, 'weekend days are not counted against the balance');
  perform t.throws(format($q$select public.apply_leave(%L, %L, %L)$q$, ty_cas, mon + 7, mon + 7), 'INSUFFICIENT_BALANCE', 'quota exhausted: 5 of 5 pending/approved used');
  perform t.ok((select count(*) from public.apply_leave(ty_sick, mon + 7, mon + 7)) = 1, 'unlimited type has no balance check');
  perform t.throws(format($q$select public.apply_leave(%L, %L, %L)$q$, ty_sick, mon + 12, mon + 13), 'NO_WORKING_DAYS', 'weekend-only range rejected');
  perform t.throws(format($q$select public.apply_leave(%L, %L, %L)$q$, ty_sick, mon + 20, mon + 19), 'INVALID_DATES', 'end before start rejected');
  perform t.throws(format($q$select public.apply_leave(%L, %L, %L, true)$q$, ty_sick, mon + 20, mon + 21), 'INVALID_DATES', 'half day over a range rejected');
  perform t.throws(format($q$select public.apply_leave(%L, '2027-12-31', '2028-01-03')$q$, ty_sick), 'INVALID_DATES', 'range spanning two years rejected');
  perform t.throws(format($q$select public.apply_leave(%L, %L, %L)$q$, ty_sick, current_date - 40, current_date - 40), 'DATE_TOO_OLD', 'request more than 30 days in the past rejected');
  perform t.throws(format($q$select public.apply_leave(%L, %L, %L)$q$, ty_sick, current_date + 400, current_date + 400), 'DATE_TOO_FAR', 'request more than a year ahead rejected');
  perform t.throws(format($q$select public.apply_leave(%L, %L, %L)$q$, ty_off, mon + 30, mon + 30), 'LEAVE_TYPE_NOT_FOUND', 'inactive leave type rejected');
  perform t.throws(format($q$select public.apply_leave(%L, %L, %L)$q$, ty_b, mon + 30, mon + 30), 'LEAVE_TYPE_NOT_FOUND', 'other company leave type rejected');
  perform t.throws(format($q$insert into public.leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, days) values (%L, %L, %L, %L, %L, 1)$q$,
      ca, t.id('eA1'), ty_sick, mon + 40, mon + 40), 'permission denied', 'clients cannot insert leave requests directly');
  perform t.throws($q$update public.leave_requests set status = 'approved'$q$, 'permission denied', 'clients cannot update leave requests directly');
  perform t.throws($q$delete from public.leave_requests$q$, 'permission denied', 'clients cannot delete leave requests');
  perform t.logout();

  perform t.login(t.id('uSuper'));
  perform t.throws(format($q$select public.apply_leave(%L, %L, %L)$q$, ty_sick, mon + 30, mon + 30), 'NO_EMPLOYEE', 'a login without an employee record cannot apply');
  perform t.logout();
  perform t.login(t.id('uA2'));
  r3 := public.apply_leave(ty_sick, mon, mon, true, null);
  perform t.ok(r3.days = 0.5 and r3.is_half_day, 'half day counts 0.5 (employee without shift uses Mon-Sat)');
  insert into t.ids values ('lv3', r3.id);
  perform t.logout();

  -- ---- visibility
  perform t.login(t.id('uA2'));
  perform t.ok((select count(*) from public.leave_requests where employee_id = t.id('eA1')) = 0, 'employee cannot see a colleague''s leave');
  perform t.logout();
  perform t.login(t.id('uMA'));
  perform t.ok((select count(*) from public.leave_requests) = 3 and (select count(*) from public.leave_requests where employee_id = t.id('eA2')) = 0, 'manager sees only assigned employees'' leave');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.ok((select count(*) from public.leave_requests) = 0, 'other company admin sees no leave of company A');
  perform t.logout();
  perform t.login(t.id('uAA'));
  perform t.ok((select count(*) from public.leave_requests) = 4, 'company admin sees all leave of own company');
  perform t.logout();

  -- ---- notifications on apply
  perform t.ok(exists (select 1 from public.notifications where employee_id = t.id('eMA') and kind = 'leave' and data ->> 'leave_request_id' = t.id('lv1')::text), 'assigned manager is notified of a new request');
  perform t.ok(exists (select 1 from public.notifications where employee_id is null and company_id = ca and kind = 'leave' and data ->> 'leave_request_id' = t.id('lv3')::text), 'request without a manager notifies company admins');

  -- ---- decide
  perform t.login(t.id('uA2'));
  perform t.throws(format($q$select public.decide_leave(%L, true)$q$, t.id('lv1')), 'FORBIDDEN', 'employee cannot decide leave');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.throws(format($q$select public.decide_leave(%L, true)$q$, t.id('lv1')), 'FORBIDDEN', 'other company admin cannot decide leave');
  perform t.logout();
  perform t.login(t.id('uMA'));
  perform t.throws(format($q$select public.decide_leave(%L, true)$q$, t.id('lv3')), 'FORBIDDEN', 'manager cannot decide leave of an unassigned employee');
  perform t.throws(format($q$select public.decide_leave(%L, false)$q$, t.id('lv1')), 'NOTE_REQUIRED', 'rejection needs a note');
  r := public.decide_leave(t.id('lv1'), true, 'ok');
  perform t.ok(r.status = 'manager_approved' and r.manager_decided_by is not null and r.decided_by is null, 'manager approval is first level only');
  perform t.throws(format($q$select public.decide_leave(%L, true)$q$, t.id('lv1')), 'INVALID_STATE', 'manager cannot act on a request already past their level');
  perform t.logout();
  perform t.ok(exists (select 1 from public.notifications where employee_id = t.id('eA1') and kind = 'leave' and title = 'Leave approved by manager'), 'employee is notified of manager approval');
  perform t.login(t.id('uAA'));
  r := public.decide_leave(t.id('lv1'), true, null);
  perform t.ok(r.status = 'approved' and r.decided_by is not null, 'admin gives final approval');
  perform t.ok(r.is_paid = (select lt.is_paid from public.leave_types lt where lt.id = r.leave_type_id), 'paid flag defaults to the leave type');
  perform t.throws(format($q$select public.decide_leave(%L, false, 'changed my mind')$q$, t.id('lv1')), 'INVALID_STATE', 'a final decision cannot be changed');
  r := public.decide_leave(t.id('lv3'), true, null, not (select lt.is_paid from public.leave_types lt join public.leave_requests q on q.leave_type_id = lt.id where q.id = t.id('lv3')));
  perform t.ok(r.status = 'approved', 'admin can approve directly (no manager assigned)');
  perform t.ok(r.is_paid is distinct from (select lt.is_paid from public.leave_types lt where lt.id = r.leave_type_id), 'admin can override paid/unpaid when approving');
  perform t.logout();

  -- self approval: admin AA is also an employee
  perform t.login(t.id('uAA'));
  r := public.apply_leave(ty_sick, mon + 14, mon + 14);
  perform t.throws(format($q$select public.decide_leave(%L, true)$q$, r.id), 'SELF_APPROVAL_NOT_ALLOWED', 'nobody can approve their own leave');
  perform t.logout();
  perform t.login(t.id('uSuper'));
  r := public.decide_leave(r.id, false, 'not this week');
  perform t.ok(r.status = 'rejected' and r.decision_note = 'not this week', 'super admin can reject with a note');
  perform t.logout();

  -- manager rejection is final
  perform t.login(t.id('uA1'));
  r := public.apply_leave(ty_sick, mon + 21, mon + 21);
  perform t.logout();
  perform t.login(t.id('uMA'));
  r := public.decide_leave(r.id, false, 'team busy');
  perform t.ok(r.status = 'rejected' and r.decided_by is not null, 'manager rejection is final');
  perform t.logout();

  -- ---- cancel
  perform t.login(t.id('uA2'));
  perform t.throws(format($q$select public.cancel_leave(%L)$q$, t.id('lv1')), 'LEAVE_NOT_FOUND', 'employee cannot cancel someone else''s leave');
  perform t.logout();
  perform t.login(t.id('uA1'));
  r := public.apply_leave(ty_sick, mon + 28, mon + 28);
  r := public.cancel_leave(r.id);
  perform t.ok(r.status = 'cancelled', 'employee cancels a pending request');
  r := public.apply_leave(ty_sick, mon + 28, mon + 28);
  perform t.ok(r.status = 'pending', 'cancelled dates can be requested again');
  r := public.cancel_leave(t.id('lv1'));
  perform t.ok(r.status = 'cancelled', 'employee can cancel an approved future leave');
  r2 := public.apply_leave(ty_sick, current_date - 3, current_date - 3);   -- retroactive within 30 days
  perform t.logout();
  perform t.login(t.id('uAA'));
  perform public.decide_leave(r2.id, true, null);
  perform t.logout();
  perform t.login(t.id('uA1'));
  perform t.throws(format($q$select public.cancel_leave(%L)$q$, r2.id), 'INVALID_STATE', 'approved leave that already started cannot be cancelled');
  perform t.logout();

  -- ---- balances
  perform t.login(t.id('uA1'));
  select * into rec from public.leave_balances(t.id('eA1'), extract(year from mon)::int) where name = 'Casual';
  perform t.ok(rec.annual_quota_days = 5 and rec.approved_days = 0 and rec.pending_days = 2 and rec.remaining_days = 3,
    'balance: cancelled leave freed, pending counted', format('%s/%s/%s', rec.approved_days, rec.pending_days, rec.remaining_days));
  perform t.ok((select remaining_days from public.leave_balances(t.id('eA1'), extract(year from mon)::int) where name = 'Sick') is null, 'unlimited type has no remaining figure');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.ok((select count(*) from public.leave_balances(t.id('eA1'), extract(year from mon)::int)) = 0, 'other company admin cannot read balances of company A employees');
  perform t.logout();

  -- ---- audit + anon
  perform t.ok((select count(*) from public.audit_logs where entity_type = 'leave_requests' and action = 'UPDATE') >= 5, 'every leave status change is audit-logged');
  perform t.ok(exists (select 1 from public.audit_logs where entity_type = 'leave_types' and action = 'INSERT'), 'leave type creation is audit-logged');
  execute 'set local role anon';
  perform t.throws($q$select public.apply_leave(null, null, null)$q$, 'permission denied', 'anon cannot apply for leave');
  perform t.throws($q$select * from public.leave_requests$q$, 'permission denied', 'anon cannot read leave requests');
  perform t.logout();
end $$;


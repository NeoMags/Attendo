-- Subscription enforcement (Phase D): employee cap, read-only guard by role/state, manager banner, service-role lookup.
-- Uses seed from 20_flows.sql: company cA (admin uAA, manager uMA, employee uA1), company cB (admin uAB), super admin uSuper.
do $$
declare ca uuid := t.id('cA'); cb uuid := t.id('cB');
        n bigint; today date := app.platform_today();
begin
  -- ============================================================ complimentary / active: everything still works
  perform t.login(t.id('uAA'));
  perform t.ok(t.rows($q$update public.departments set name = name$q$) >= 0, 'active company admin can still write');
  perform t.ok((select count(*) from public.my_subscription()) = 1, 'company admin sees my_subscription');
  perform t.logout();
  perform t.login(t.id('uMA'));
  perform t.ok((select count(*) from public.my_subscription()) = 1 and (select state from public.my_subscription()) = 'active', 'manager sees my_subscription for the banner');
  perform t.logout();
  perform t.login(t.id('uA1'));
  perform t.ok((select count(*) from public.my_subscription()) = 0, 'employee still has no my_subscription');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.ok((select company_id from public.company_subscriptions limit 1) = cb and (select count(*) from public.company_subscriptions) = 1, 'company admin sees only their own subscription row');
  perform t.logout();

  -- ============================================================ employee cap
  update public.company_subscriptions set is_complimentary = false, max_employees = (select count(*) from public.employees where company_id = ca and is_active),
    expires_on = today + 30 where company_id = ca;
  perform t.throws(format($q$insert into public.employees (company_id, employee_code, full_name) values (%L, 'CAP1', 'Over Cap')$q$, ca),
    'EMPLOYEE_LIMIT_REACHED', 'a new active employee beyond the cap is rejected (any writer)');
  perform t.service();
  perform t.throws(format($q$insert into public.employees (company_id, employee_code, full_name) values (%L, 'CAP2', 'Over Cap 2')$q$, ca),
    'EMPLOYEE_LIMIT_REACHED', 'the cap also binds the service role');
  perform t.logout();
  insert into public.employees (company_id, employee_code, full_name, is_active) values (ca, 'CAP3', 'Inactive Ok', false);
  perform t.ok(exists (select 1 from public.employees where employee_code = 'CAP3' and company_id = ca), 'an inactive employee does not count against the cap');
  perform t.throws(format($q$update public.employees set is_active = true where employee_code = 'CAP3' and company_id = %L$q$, ca),
    'EMPLOYEE_LIMIT_REACHED', 'reactivating beyond the cap is rejected');
  update public.company_subscriptions set max_employees = max_employees + 1 where company_id = ca;
  update public.employees set is_active = true where employee_code = 'CAP3' and company_id = ca;
  perform t.ok((select is_active from public.employees where employee_code = 'CAP3' and company_id = ca), 'reactivating within the cap works after the cap is raised');
  perform t.ok(t.rows(format($q$update public.employees set full_name = full_name where company_id = %L$q$, ca)) > 0, 'editing existing employees at the cap is fine');
  update public.company_subscriptions set max_employees = 1 where company_id = ca;
  perform t.ok(t.rows(format($q$update public.employees set full_name = full_name where company_id = %L$q$, ca)) > 0, 'a lowered cap does not break edits to existing staff');
  update public.company_subscriptions set max_employees = 100 where company_id = ca;
  perform t.ok(exists (select 1 from public.employees where company_id = cb limit 1), 'other company data untouched');

  -- ============================================================ grace: dashboard read-only, employee app works
  update public.company_subscriptions set starts_on = today - 400, expires_on = today - 1 where company_id = ca;
  perform t.ok(app.subscription_state(ca) = 'grace', 'one day past expiry is grace');
  perform t.login(t.id('uAA'));
  perform t.throws($q$update public.departments set name = name$q$, 'SUBSCRIPTION_EXPIRED', 'company admin is read-only during grace');
  perform t.throws($q$insert into public.departments (company_id, name) select company_id, 'X' from public.departments limit 1$q$, 'SUBSCRIPTION_EXPIRED', 'company admin cannot insert during grace');
  perform t.ok((select count(*) from public.employees) > 0, 'company admin can still read during grace');
  perform t.ok((select state from public.my_subscription()) = 'grace', 'my_subscription reports grace');
  perform t.logout();
  perform t.login(t.id('uMA'));
  perform t.throws($q$update public.shifts set name = name$q$, 'SUBSCRIPTION_EXPIRED', 'manager is read-only during grace');
  perform t.logout();
  perform t.login(t.id('uA1'));
  perform t.ok(t.rows($q$update public.employee_profiles set updated_at = updated_at$q$) >= 0, 'employee writes still work during grace');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.ok(t.rows($q$update public.departments set name = name$q$) >= 0, 'another company is unaffected');
  perform t.logout();
  perform t.login(t.id('uSuper'));
  perform t.ok(t.rows(format($q$update public.departments set name = name where company_id = %L$q$, ca)) >= 0, 'super admin is never blocked');
  perform t.logout();
  perform t.service();
  perform t.ok(t.rows(format($q$update public.departments set name = name where company_id = %L$q$, ca)) >= 0, 'service role is not blocked by the guard');
  perform t.ok(public.subscription_state_for(ca) = 'grace', 'service role can look up the state');
  perform t.logout();

  -- ============================================================ expired: employees blocked too
  update public.company_subscriptions set starts_on = today - 400, expires_on = today - 10 where company_id = ca;
  perform t.ok(app.subscription_state(ca) = 'expired', 'past grace is expired');
  perform t.login(t.id('uA1'));
  perform t.throws($q$update public.employee_profiles set updated_at = updated_at$q$, 'SUBSCRIPTION_EXPIRED', 'employee writes are rejected once expired');
  perform t.logout();
  perform t.login(t.id('uAA'));
  perform t.throws($q$delete from public.departments$q$, 'SUBSCRIPTION_EXPIRED', 'company admin deletes are rejected once expired');
  perform t.ok((select state from public.my_subscription()) = 'expired', 'my_subscription reports expired');
  perform t.logout();

  -- ============================================================ renewal restores everything
  update public.company_subscriptions set expires_on = today + 30 where company_id = ca;
  perform t.login(t.id('uAA'));
  perform t.ok(t.rows($q$update public.departments set name = name$q$) >= 0, 'writes work again after renewal');
  perform t.logout();

  -- ============================================================ lockdown of the lookup
  perform t.login(t.id('uAA'));
  perform t.throws(format($q$select public.subscription_state_for(%L)$q$, ca), 'permission denied', 'clients cannot call the service-role lookup');
  perform t.logout();
  execute 'set local role anon';
  perform t.throws(format($q$select public.subscription_state_for(%L)$q$, ca), 'permission denied', 'anon cannot call the service-role lookup');
  perform t.logout();

  -- restore the seed company to complimentary so later files see the original state
  update public.company_subscriptions set is_complimentary = true, max_employees = 100000, expires_on = date '2099-12-31' where company_id = ca;
end $$;

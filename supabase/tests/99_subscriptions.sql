-- Subscriptions (Phase A): plans, payment settings, requests, approve/reject/renew, RLS, storage.
-- Uses seed from 20_flows.sql: companies cA/cB, company admins uAA/uAB, employee uA1, super admin uSuper.
do $$
declare sup uuid := t.id('uSuper'); n int; msg text;
begin
  -- ============================================================ plans
  perform t.ok((select count(*) from public.plans where is_active) = 4, 'four placeholder plans are seeded');

  perform t.logout();
  execute 'set local role anon';
  perform t.ok((select count(*) from public.list_public_plans()) = 4, 'anonymous visitors can read active plans through the public function');
  perform t.throws($q$select * from public.plans$q$, 'permission denied', 'anon has no direct access to the plans table');
  perform t.ok(not exists (select 1 from public.list_public_plans() where name = 'Starter' and price_inr <> 999), 'public plans expose price and caps');
  perform t.throws($q$select * from public.subscription_requests$q$, 'permission denied', 'anon cannot read subscription requests');
  perform t.throws($q$select * from public.company_subscriptions$q$, 'permission denied', 'anon cannot read company subscriptions');
  perform t.throws($q$select * from public.platform_settings$q$, 'permission denied', 'anon cannot read platform settings table');
  perform t.throws($q$insert into public.plans (name, price_inr, max_employees, duration_months) values ('Evil', 0, 1, 1)$q$, 'permission denied', 'anon cannot write plans');
  perform t.throws($q$select public.submit_subscription_request(gen_random_uuid(), 'a', 'b', 'a@b.co', '9999999999', 'ABCDEFGHIJKL', 'x')$q$,
    'permission denied', 'anon cannot call submit directly (only the Edge Function can)');
  perform t.ok((select count(*) from public.get_payment_info()) = 1, 'anon can read public payment info');
  perform t.logout();

  perform t.login(t.id('uAA'));
  perform t.throws($q$insert into public.plans (name, price_inr, max_employees, duration_months) values ('Mine', 1, 1, 1)$q$, 'row-level security', 'company admin cannot create plans');
  perform t.ok(t.rows($q$update public.plans set price_inr = 1$q$) = 0, 'company admin cannot edit plans');
  perform t.logout();

  perform t.login(sup);
  insert into public.plans (name, description, price_inr, max_employees, duration_months, sort_order) values ('Tiny', 'x', 199, 3, 1, 5);
  perform t.ok(exists (select 1 from public.plans where name = 'Tiny'), 'super admin creates a plan');
  perform t.throws($q$insert into public.plans (name, price_inr, max_employees, duration_months) values ('  tiny ', 1, 1, 1)$q$, 'duplicate key', 'plan names are unique, case-insensitive');
  perform t.throws($q$insert into public.plans (name, price_inr, max_employees, duration_months) values ('Neg', -1, 1, 1)$q$, 'violates check', 'negative price rejected');
  perform t.throws($q$insert into public.plans (name, price_inr, max_employees, duration_months) values ('Zero', 1, 0, 1)$q$, 'violates check', 'zero employee cap rejected');
  perform t.throws($q$insert into public.plans (name, price_inr, max_employees, duration_months) values ('Long', 1, 1, 99)$q$, 'violates check', 'absurd duration rejected');
  update public.plans set is_active = false where name = 'Tiny';
  perform t.ok((select count(*) from public.plans where name = 'Tiny') = 1, 'super admin still sees inactive plans');
  perform t.ok(exists (select 1 from public.audit_logs where entity_type = 'plans' and action = 'INSERT' and actor_user_id = sup), 'plan creation is audit-logged with the actor');
  perform t.logout();

  execute 'set local role anon';
  perform t.ok((select count(*) from public.list_public_plans() where name = 'Tiny') = 0 and (select count(*) from public.list_public_plans()) = 4, 'anon cannot see inactive plans');
  perform t.logout();
  perform t.login(t.id('uAA'));
  perform t.ok((select count(*) from public.plans where name = 'Tiny') = 0, 'company admin cannot see inactive plans');
  perform t.logout();

  -- ============================================================ platform settings + payment info
  perform t.login(sup);
  update public.platform_settings set upi_id = 'attendo@okaxis', payee_name = 'Attendo Technologies';
  perform t.ok((select upi_id from public.platform_settings) = 'attendo@okaxis', 'super admin saves UPI id and payee name');
  perform t.throws($q$update public.platform_settings set upi_id = 'not a upi id'$q$, 'violates check', 'malformed UPI id rejected');
  perform t.throws($q$update public.platform_settings set grace_days = 31$q$, 'violates check', 'grace period bounded to 30 days');
  perform t.throws($q$update public.platform_settings set qr_path = '../../etc/passwd'$q$, 'violates check', 'QR path must be a qr/<uuid>.<ext> object');
  update public.platform_settings set qr_path = 'qr/' || gen_random_uuid() || '.png';
  perform t.ok((select count(*) from public.platform_settings) = 1, 'settings stay a single row');
  perform t.throws($q$insert into public.platform_settings (id) values (false)$q$, 'permission denied', 'cannot add a second settings row');
  perform t.logout();

  perform t.login(t.id('uAA'));
  perform t.ok((select count(*) from public.platform_settings) = 0, 'company admin cannot read platform settings table');
  perform t.ok(t.rows($q$update public.platform_settings set upi_id = 'evil@upi'$q$) = 0, 'company admin cannot change the UPI id');
  perform t.ok((select upi_id from public.get_payment_info()) = 'attendo@okaxis', 'but any user can read the public payment info');
  perform t.ok(pg_get_function_result('public.get_payment_info()'::regprocedure) not like '%grace%', 'payment info does not expose grace_days');
  perform t.logout();
  update public.platform_settings set grace_days = 3;
  perform t.ok((select grace_days from public.platform_settings) = 3, 'grace period is 3 days');
end $$;

-- ============================================================ complimentary backfill + states
do $$
declare sup uuid := t.id('uSuper'); ca uuid := t.id('cA'); cb uuid := t.id('cB'); c uuid; today date := app.platform_today(); starter uuid;
begin
  select id into starter from public.plans where name = 'Starter';
  perform t.ok((select is_complimentary from public.company_subscriptions where company_id = ca), 'existing companies are grandfathered as complimentary');
  perform t.ok(app.subscription_state(ca) = 'active', 'complimentary company is active');
  insert into public.companies (code, name) values ('fresh', 'Fresh Co') returning id into c;
  perform t.ok((select is_complimentary from public.company_subscriptions where company_id = c), 'a company created by the owner is complimentary by default');
  perform t.ok(app.subscription_state(gen_random_uuid()) = 'none', 'unknown company has no subscription');

  perform t.login(t.id('uAA'));
  perform t.throws(format($q$select public.set_company_subscription(%L, %L, current_date, false)$q$, ca, starter), 'FORBIDDEN', 'company admin cannot override a subscription');
  perform t.logout();

  perform t.login(sup);
  perform t.throws(format($q$select public.set_company_subscription(%L, null, null, false)$q$, ca), 'PLAN_AND_EXPIRY_REQUIRED', 'paid override needs plan and expiry');
  perform t.throws(format($q$select public.set_company_subscription(%L, %L, current_date, false)$q$, gen_random_uuid(), starter), 'COMPANY_NOT_FOUND', 'override of unknown company rejected');
  perform public.set_company_subscription(cb, starter, today + 10, false);
  perform t.ok(app.subscription_state(cb) = 'active' and (select max_employees from public.company_subscriptions where company_id = cb) = 10, 'owner sets a paid plan on an existing company');
  perform public.set_company_subscription(cb, starter, today, false);
  perform t.ok(app.subscription_state(cb) = 'active', 'expiry day itself is still active');
  perform public.set_company_subscription(cb, starter, today - 1, false);
  perform t.ok(app.subscription_state(cb) = 'grace', 'day after expiry is grace');
  perform public.set_company_subscription(cb, starter, today - 3, false);
  perform t.ok(app.subscription_state(cb) = 'grace', 'third day after expiry is still grace');
  perform public.set_company_subscription(cb, starter, today - 4, false);
  perform t.ok(app.subscription_state(cb) = 'expired', 'fourth day after expiry is expired');
  perform public.set_company_subscription(cb, null, null, true);
  perform t.ok(app.subscription_state(cb) = 'active' and (select is_complimentary from public.company_subscriptions where company_id = cb), 'owner can make a company complimentary again');
  perform t.logout();
end $$;

-- ============================================================ requests
do $$
declare starter uuid; growth uuid; r public.subscription_requests; r2 public.subscription_requests; msg text;
  rec text := '11111111-1111-1111-1111-111111111111/receipt.jpg';
begin
  select id into starter from public.plans where name = 'Starter';
  select id into growth from public.plans where name = 'Growth';
  perform t.service();

  r := public.submit_subscription_request(starter, '  Ravi Kumar ', ' Kumar Traders ', ' Ravi@Kumar.IN ', '+91 98765-43210', ' utr123456789012 ', rec);
  perform t.ok(r.status = 'pending' and r.kind = 'new' and r.company_id is null, 'request is created pending');
  perform t.ok(r.email = 'ravi@kumar.in' and r.utr = 'UTR123456789012' and r.phone = '+919876543210' and r.applicant_name = 'Ravi Kumar', 'input is trimmed and normalised (email lower, UTR upper, phone digits)');
  perform t.ok(r.reference ~ '^SR-[0-9A-F]{8}$', 'request gets a short reference');
  perform t.ok(r.plan_name = 'Starter' and r.amount_inr = 999 and r.max_employees = 10 and r.duration_months = 1, 'plan terms are snapshotted on the request');

  perform t.throws(format($q$select public.submit_subscription_request(%L, 'A', 'B', 'other@x.in', '9876543211', 'utr123456789012', %L)$q$, growth, '22222222-2222-2222-2222-222222222222/receipt.png'),
    'UTR_ALREADY_USED', 'same UTR cannot be used twice (case-insensitive)');
  perform t.throws(format($q$select public.submit_subscription_request(%L, 'A', 'B', 'RAVI@kumar.in', '9876543211', 'OTHERUTR123456', %L)$q$, growth, '22222222-2222-2222-2222-222222222222/receipt.png'),
    'REQUEST_ALREADY_PENDING', 'one pending request per email');
  perform t.throws(format($q$select public.submit_subscription_request(gen_random_uuid(), 'A', 'B', 'o@x.in', '9876543211', 'OTHERUTR123456', %L)$q$, rec), 'PLAN_NOT_AVAILABLE', 'unknown plan rejected');
  perform t.throws(format($q$select public.submit_subscription_request(%L, 'A', 'B', 'not-an-email', '9876543211', 'OTHERUTR123456', %L)$q$, starter, rec), 'INVALID_EMAIL', 'bad email rejected');
  perform t.throws(format($q$select public.submit_subscription_request(%L, 'A', 'B', 'o@x.in', '12345', 'OTHERUTR123456', %L)$q$, starter, rec), 'INVALID_PHONE', 'bad phone rejected');
  perform t.throws(format($q$select public.submit_subscription_request(%L, 'A', 'B', 'o@x.in', '9876543211', 'SHORT', %L)$q$, starter, rec), 'INVALID_UTR', 'short UTR rejected');
  perform t.throws(format($q$select public.submit_subscription_request(%L, 'A', 'B', 'o@x.in', '9876543211', 'OTHER-UTR-12345', %L)$q$, starter, rec), 'INVALID_UTR', 'UTR with symbols rejected');
  perform t.throws(format($q$select public.submit_subscription_request(%L, 'A', 'B', 'o@x.in', '9876543211', 'OTHERUTR123456', '../x.jpg')$q$, starter), 'INVALID_RECEIPT', 'receipt path must be <uuid>/receipt.<ext>');
  perform t.throws(format($q$select public.submit_subscription_request(%L, '   ', 'B', 'o@x.in', '9876543211', 'OTHERUTR123456', %L)$q$, starter, rec), 'INVALID_NAME', 'blank applicant name rejected');
  perform t.throws(format($q$select public.submit_subscription_request(%L, 'A', 'B', 'o@x.in', '9876543211', 'OTHERUTR123456', %L, gen_random_uuid())$q$, starter, rec), 'COMPANY_NOT_FOUND', 'renewal for unknown company rejected');

  -- editing the plan later never changes what the customer paid for
  update public.plans set price_inr = 1500, max_employees = 5 where id = starter;
  perform t.ok((select amount_inr from public.subscription_requests where id = r.id) = 999 and (select max_employees from public.subscription_requests where id = r.id) = 10, 'later plan edits do not change an existing request');
  update public.plans set price_inr = 999, max_employees = 10 where id = starter;

  update public.plans set is_active = false where id = growth;
  perform t.throws(format($q$select public.submit_subscription_request(%L, 'A', 'B', 'g@x.in', '9876543211', 'GROWTHUTR12345', %L)$q$, growth, rec), 'PLAN_NOT_AVAILABLE', 'inactive plan cannot be requested');
  update public.plans set is_active = true where id = growth;
  perform t.logout();

  perform t.login(t.id('uSuper'));
  perform t.throws(format($q$update public.subscription_requests set status = 'approved' where id = %L$q$, r.id), 'permission denied', 'even a super admin cannot approve by writing the table directly');
  perform t.logout();
end $$;

-- ============================================================ visibility
do $$
declare sup uuid := t.id('uSuper');
begin
  perform t.login(sup);
  perform t.ok((select count(*) from public.subscription_requests) = 1, 'super admin sees all requests');
  perform t.logout();
  perform t.login(t.id('uAA'));
  perform t.ok((select count(*) from public.subscription_requests) = 0, 'company admin does not see new-customer requests');
  perform t.throws($q$insert into public.subscription_requests (plan_id, plan_name, amount_inr, max_employees, duration_months, applicant_name, company_name, email, phone, utr, receipt_path)
    select id, name, 0, 1, 1, 'x', 'x', 'x@y.zz', '9999999999', 'ZZZZZZZZZZZZ', 'x' from public.plans limit 1$q$, 'permission denied', 'clients cannot insert requests');
  perform t.logout();
  perform t.login(t.id('uA1'));
  perform t.ok((select count(*) from public.subscription_requests) = 0 and (select count(*) from public.company_subscriptions) = 0 and (select count(*) from public.my_subscription()) = 0, 'employees see no subscription data');
  perform t.logout();
  perform t.login(t.id('uMA'));
  perform t.ok((select count(*) from public.company_subscriptions) = 0, 'managers do not see subscription data either');
  perform t.logout();
end $$;

-- ============================================================ reject
do $$
declare sup uuid := t.id('uSuper'); r uuid; starter uuid; r2 public.subscription_requests;
  rec text := '33333333-3333-3333-3333-333333333333/receipt.png';
begin
  select id into r from public.subscription_requests where email = 'ravi@kumar.in';
  select id into starter from public.plans where name = 'Starter';

  perform t.login(t.id('uAA'));
  perform t.throws(format($q$select public.reject_subscription_request(%L, 'no')$q$, r), 'FORBIDDEN', 'company admin cannot reject');
  perform t.logout();
  perform t.login(sup);
  perform t.throws(format($q$select public.reject_subscription_request(%L, '   ')$q$, r), 'INVALID_REASON', 'rejection needs a reason');
  perform t.throws(format($q$select public.reject_subscription_request(%L, 'x')$q$, gen_random_uuid()), 'REQUEST_NOT_FOUND', 'unknown request');
  perform public.reject_subscription_request(r, 'UTR not found in bank statement');
  perform t.ok((select status = 'rejected' and reject_reason = 'UTR not found in bank statement' and reviewed_by = sup and reviewed_at is not null from public.subscription_requests where id = r), 'rejection records reason, reviewer and time');
  perform t.ok(exists (select 1 from public.audit_logs where action = 'SUBSCRIPTION_REJECTED' and actor_user_id = sup and entity_id = r::text), 'rejection is audit-logged');
  perform t.throws(format($q$select public.reject_subscription_request(%L, 'again')$q$, r), 'NOT_PENDING', 'cannot reject twice');
  perform t.logout();

  perform t.service();
  perform t.throws(format($q$select public.approve_subscription_request(%L, %L, gen_random_uuid())$q$, r, sup), 'NOT_PENDING', 'a rejected request cannot be approved');
  -- a rejected request frees its UTR and email
  r2 := public.submit_subscription_request(starter, 'Ravi Kumar', 'Kumar Traders', 'ravi@kumar.in', '9876543210', 'UTR123456789012', rec);
  perform t.ok(r2.status = 'pending' and r2.id <> r, 'after rejection the customer can resubmit with the same UTR and email');
  perform t.logout();
end $$;

-- ============================================================ approve
do $$
declare sup uuid := t.id('uSuper'); r uuid; admin_u uuid; co uuid; today date := app.platform_today(); starter uuid; r2 public.subscription_requests; u2 uuid; co2 uuid;
begin
  select id into r from public.subscription_requests where email = 'ravi@kumar.in' and status = 'pending';
  insert into auth.users (phone) values (null) returning id into admin_u;
  insert into auth.users (phone) values (null) returning id into u2;

  perform t.service();
  perform t.throws(format($q$select public.approve_subscription_request(%L, %L, %L)$q$, r, t.id('uAA'), admin_u), 'FORBIDDEN', 'only a super admin can be the approving actor');
  perform t.throws(format($q$select public.approve_subscription_request(%L, %L, null)$q$, r, sup), 'ADMIN_USER_REQUIRED', 'a new customer needs an admin login');
  perform t.throws(format($q$select public.approve_subscription_request(%L, %L, %L, 'acme')$q$, r, sup, admin_u), 'COMPANY_CODE_TAKEN', 'explicit company code that exists is rejected');
  perform t.ok(not exists (select 1 from public.companies where name = 'Kumar Traders'), 'a failed approval leaves no half-created company');

  co := public.approve_subscription_request(r, sup, admin_u);
  perform t.ok((select code from public.companies where id = co) = 'kumar-traders', 'company code is derived from the company name');
  perform t.ok((select role from public.user_roles where user_id = admin_u and company_id = co) = 'company_admin', 'customer becomes company_admin of the new company');
  perform t.ok((select expires_on from public.company_subscriptions where company_id = co) = (today + interval '1 month')::date
    and not (select is_complimentary from public.company_subscriptions where company_id = co)
    and (select max_employees from public.company_subscriptions where company_id = co) = 10
    and (select plan_name from public.company_subscriptions where company_id = co) = 'Starter', 'subscription starts today for the paid duration with the paid cap');
  perform t.ok((select status = 'approved' and approved_company_id = co and reviewed_by = sup from public.subscription_requests where id = r), 'request is marked approved with reviewer and company');
  perform t.ok(exists (select 1 from public.audit_logs where action = 'SUBSCRIPTION_APPROVED' and actor_user_id = sup and company_id = co), 'approval is audit-logged');
  perform t.throws(format($q$select public.approve_subscription_request(%L, %L, gen_random_uuid())$q$, r, sup), 'NOT_PENDING', 'cannot approve twice');

  -- two customers with the same company name get different codes
  select id into starter from public.plans where name = 'Starter';
  r2 := public.submit_subscription_request(starter, 'Other Kumar', 'Kumar Traders', 'other@kumar.in', '9876500000', 'SECONDUTR123456', '44444444-4444-4444-4444-444444444444/receipt.jpg');
  co2 := public.approve_subscription_request(r2.id, sup, u2);
  perform t.ok((select code from public.companies where id = co2) like 'kumar-traders-%' and co2 <> co, 'duplicate company names get a unique code suffix');
  perform t.logout();

  -- the new customer's view
  perform t.login(admin_u);
  perform t.ok((select count(*) from public.my_subscription()) = 1 and (select state from public.my_subscription()) = 'active' and (select plan_name from public.my_subscription()) = 'Starter', 'new company admin sees an active Starter subscription');
  perform t.ok((select employee_count from public.my_subscription()) = 0 and (select days_left from public.my_subscription()) between 27 and 31, 'my_subscription reports employee count and days left');
  perform t.ok((select count(*) from public.company_subscriptions) = 1, 'company admin sees only their own subscription row');
  perform t.logout();
  perform t.login(sup);
  perform t.ok((select count(*) from public.my_subscription()) = 0, 'super admin has no company subscription of their own');
  perform t.logout();
end $$;

-- ============================================================ renewal
do $$
declare sup uuid := t.id('uSuper'); co uuid; starter uuid; growth uuid; old_exp date; r public.subscription_requests; today date := app.platform_today(); admin_u uuid;
begin
  select id into co from public.companies where code = 'kumar-traders';
  select id into starter from public.plans where name = 'Starter';
  select id into growth from public.plans where name = 'Growth';
  select expires_on into old_exp from public.company_subscriptions where company_id = co;
  select user_id into admin_u from public.user_roles where company_id = co;

  perform t.service();
  r := public.submit_subscription_request(growth, 'Ravi Kumar', 'Kumar Traders', 'ravi@kumar.in', '9876543210', 'RENEWALUTR12345', '55555555-5555-5555-5555-555555555555/receipt.jpg', co);
  perform t.ok(r.kind = 'renewal' and r.company_id = co, 'renewal request is tied to the company');
  perform t.logout();

  perform t.login(admin_u);
  perform t.ok((select count(*) from public.subscription_requests) = 1, 'company admin sees their own renewal request');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.ok((select count(*) from public.subscription_requests) = 0, 'another company admin cannot see it');
  perform t.logout();

  perform t.service();
  perform t.ok(public.approve_subscription_request(r.id, sup) = co, 'renewal needs no new login and returns the same company');
  perform t.ok((select expires_on from public.company_subscriptions where company_id = co) = (old_exp + interval '1 month')::date, 'renewing before expiry extends from the old expiry');
  perform t.ok((select plan_name from public.company_subscriptions where company_id = co) = 'Growth' and (select max_employees from public.company_subscriptions where company_id = co) = 50, 'renewal can change the plan and cap');
  perform t.ok((select count(*) from public.user_roles where company_id = co) = 1, 'renewal does not create another login');
  perform t.logout();

  -- lapsed company renews: starts from today, not from the old date
  perform t.login(sup);
  perform public.set_company_subscription(co, starter, today - 20, false);
  perform t.logout();
  perform t.service();
  r := public.submit_subscription_request(starter, 'Ravi Kumar', 'Kumar Traders', 'ravi@kumar.in', '9876543210', 'LAPSEDUTR123456', '66666666-6666-6666-6666-666666666666/receipt.jpg', co);
  perform public.approve_subscription_request(r.id, sup);
  perform t.ok((select expires_on from public.company_subscriptions where company_id = co) = (today + interval '1 month')::date, 'renewing after expiry restarts from today');
  perform t.ok(app.subscription_state(co) = 'active', 'company is active again after renewal');
  perform t.logout();
end $$;

-- ============================================================ storage
do $$
declare sup uuid := t.id('uSuper'); q text := 'qr/' || gen_random_uuid() || '.png';
begin
  perform t.ok((select not public from storage.buckets where id = 'receipts') and (select file_size_limit from storage.buckets where id = 'receipts') = 3145728, 'receipts bucket is private with a 3 MB limit');
  perform t.ok((select public from storage.buckets where id = 'platform-assets') and (select file_size_limit from storage.buckets where id = 'platform-assets') = 1048576, 'platform-assets bucket is public with a 1 MB limit');
  perform t.ok((select 'application/pdf' = any (allowed_mime_types) from storage.buckets where id = 'receipts') and not (select 'application/pdf' = any (allowed_mime_types) from storage.buckets where id = 'platform-assets'), 'receipts may be PDF; the QR image may not');

  insert into storage.objects (bucket_id, name) values ('receipts', '77777777-7777-7777-7777-777777777777/receipt.jpg');
  perform t.login(t.id('uAA'));
  perform t.ok((select count(*) from storage.objects where bucket_id = 'receipts') = 0, 'company admin cannot read receipts');
  perform t.throws($q$insert into storage.objects (bucket_id, name) values ('receipts', '88888888-8888-8888-8888-888888888888/receipt.jpg')$q$, 'row-level security', 'clients cannot upload receipts directly');
  perform t.throws(format($q$insert into storage.objects (bucket_id, name) values ('platform-assets', %L)$q$, q), 'row-level security', 'company admin cannot upload the QR');
  perform t.logout();
  perform t.login(sup);
  perform t.ok((select count(*) from storage.objects where bucket_id = 'receipts') = 1, 'super admin can read receipts');
  insert into storage.objects (bucket_id, name) values ('platform-assets', q);
  perform t.ok(exists (select 1 from storage.objects where name = q), 'super admin uploads the QR image');
  perform t.throws($q$insert into storage.objects (bucket_id, name) values ('platform-assets', 'anything.png')$q$, 'row-level security', 'QR upload must follow the qr/<uuid>.<ext> path');
  perform t.logout();
end $$;

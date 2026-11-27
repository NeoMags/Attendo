-- Subscriptions (Phase A): plans, platform payment settings, subscription requests, per-company subscription.
-- Flow: visitor picks a plan -> pays by UPI -> submits UTR + receipt (via Edge Function, service_role) ->
-- super admin verifies and approves -> company + company_admin login + subscription are created atomically.
-- Clients never write requests or subscriptions directly; every write goes through a checked RPC.

create type public.subscription_request_status as enum ('pending', 'approved', 'rejected');

-- ---------------------------------------------------------------- helpers
-- Platform-wide "today" (India). Subscriptions are sold in India, so one calendar for every customer.
create function app.platform_today() returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date $$;

-- ---------------------------------------------------------------- plans (editable by the platform owner)
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 60),
  description text check (description is null or length(description) <= 300),
  price_inr numeric(10, 2) not null check (price_inr >= 0),
  max_employees integer not null check (max_employees between 1 and 100000),
  duration_months integer not null check (duration_months between 1 and 36),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index plans_name_uq on public.plans (lower(btrim(name)));
create trigger plans_touch before update on public.plans for each row execute function app.touch_updated_at();
create trigger audit_plans after insert or update or delete on public.plans for each row execute function app.audit_row();

-- Placeholder plans. The platform owner edits these from Settings.
insert into public.plans (name, description, price_inr, max_employees, duration_months, sort_order) values
  ('Starter',       'Small teams getting started with attendance and field tracking.', 999,   10,  1,  10),
  ('Growth',        'Growing teams with several managers and sites.',                  2999,  50,  1,  20),
  ('Business',      'Larger field teams with payroll and reporting needs.',            6999,  200, 1,  30),
  ('Growth Annual', 'Growth plan billed yearly. Two months free.',                     29990, 50,  12, 40);

-- ---------------------------------------------------------------- platform payment settings (single row)
create table public.platform_settings (
  id boolean primary key default true check (id),
  upi_id text check (upi_id is null or upi_id ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9]{1,31}$'),
  payee_name text check (payee_name is null or length(btrim(payee_name)) between 1 and 100),
  qr_path text check (qr_path is null or qr_path ~ '^qr/[0-9a-f-]{36}\.(png|jpg|webp)$'),
  grace_days integer not null default 3 check (grace_days between 0 and 30),
  updated_at timestamptz not null default now()
);
insert into public.platform_settings default values;
create trigger platform_settings_touch before update on public.platform_settings for each row execute function app.touch_updated_at();
create trigger audit_platform_settings after update on public.platform_settings for each row execute function app.audit_row();

-- Public pricing page. A function (not an anon table grant) keeps "anon has no table access" true platform-wide
-- and exposes only active plans and only customer-facing columns.
create function public.list_public_plans()
returns table (id uuid, name text, description text, price_inr numeric, max_employees integer, duration_months integer)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, p.description, p.price_inr, p.max_employees, p.duration_months
  from public.plans p where p.is_active order by p.sort_order, p.price_inr $$;

-- What a customer needs to pay. Deliberately excludes grace_days and anything else internal.
create function public.get_payment_info() returns table (upi_id text, payee_name text, qr_path text)
language sql stable security definer set search_path = '' as $$
  select s.upi_id, s.payee_name, s.qr_path from public.platform_settings s $$;

-- ---------------------------------------------------------------- requests
create table public.subscription_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('SR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  kind text not null default 'new' check (kind in ('new', 'renewal')),
  status public.subscription_request_status not null default 'pending',
  -- snapshot of what the customer saw and paid for; later plan edits never change a request
  plan_id uuid not null references public.plans (id) on delete restrict,
  plan_name text not null,
  amount_inr numeric(10, 2) not null,
  max_employees integer not null,
  duration_months integer not null,
  applicant_name text not null check (length(btrim(applicant_name)) between 1 and 120),
  company_name text not null check (length(btrim(company_name)) between 1 and 200),
  email text not null check (email = lower(email) and length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone text not null check (phone ~ '^\+?[0-9]{10,15}$'),
  utr text not null check (utr ~ '^[A-Z0-9]{12,22}$'),
  receipt_path text not null check (receipt_path ~ '^[0-9a-f-]{36}/receipt\.(jpg|png|webp|pdf)$'),
  company_id uuid references public.companies (id),           -- set only for renewals
  approved_company_id uuid references public.companies (id),
  reviewed_by uuid,
  reviewed_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now(),
  check ((kind = 'renewal') = (company_id is not null)),
  check ((status = 'pending') = (reviewed_at is null)),
  check (status <> 'approved' or approved_company_id is not null),
  check (status <> 'rejected' or (reject_reason is not null and length(btrim(reject_reason)) between 1 and 300))
);
-- One payment proof can only ever buy one subscription. A rejected request frees its UTR.
create unique index subscription_requests_utr_live on public.subscription_requests (utr) where status <> 'rejected';
-- One open request per email: stops spam and double-approval.
create unique index subscription_requests_one_pending_email on public.subscription_requests (email) where status = 'pending';
create index subscription_requests_status_time on public.subscription_requests (status, created_at desc);

-- ---------------------------------------------------------------- per-company subscription
create table public.company_subscriptions (
  company_id uuid primary key references public.companies (id) on delete cascade,
  plan_id uuid references public.plans (id) on delete set null,
  plan_name text not null,
  max_employees integer not null check (max_employees >= 1),
  starts_on date not null,
  expires_on date not null,
  is_complimentary boolean not null default false,        -- granted by the platform owner, never expires
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_on >= starts_on)
);
create trigger company_subscriptions_touch before update on public.company_subscriptions for each row execute function app.touch_updated_at();
create trigger audit_company_subscriptions after insert or update or delete on public.company_subscriptions for each row execute function app.audit_row();

-- Every existing company keeps working: grandfather them as complimentary. The owner can change this per company.
insert into public.company_subscriptions (company_id, plan_name, max_employees, starts_on, expires_on, is_complimentary)
select c.id, 'Complimentary', 100000, app.platform_today(), date '2099-12-31', true from public.companies c;

-- A company created any other way (e.g. by the owner in the Companies page) is complimentary until the owner says otherwise.
create function app.default_subscription() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.company_subscriptions (company_id, plan_name, max_employees, starts_on, expires_on, is_complimentary)
  values (new.id, 'Complimentary', 100000, app.platform_today(), date '2099-12-31', true)
  on conflict (company_id) do nothing;
  return new;
end $$;
create trigger companies_default_subscription after insert on public.companies for each row execute function app.default_subscription();

-- active = full use; grace = expired but inside the grace window (dashboard read-only, employee app still works);
-- expired = past grace (dashboard read-only, employee app blocked). Enforcement is wired in a later phase.
create function app.subscription_state(p_company uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when s.company_id is null then 'none'
    when s.is_complimentary or app.platform_today() <= s.expires_on then 'active'
    when app.platform_today() <= s.expires_on + (select ps.grace_days from public.platform_settings ps) then 'grace'
    else 'expired' end
  from (select 1) x left join public.company_subscriptions s on s.company_id = p_company $$;

create function public.my_subscription()
returns table (state text, plan_name text, max_employees integer, employee_count bigint, expires_on date, days_left integer, is_complimentary boolean)
language sql stable security definer set search_path = '' as $$
  select app.subscription_state(s.company_id), s.plan_name, s.max_employees,
         (select count(*) from public.employees e where e.company_id = s.company_id and e.is_active),
         s.expires_on, (s.expires_on - app.platform_today()), s.is_complimentary
  from public.company_subscriptions s
  where s.company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin' $$;

-- ---------------------------------------------------------------- RPCs
-- Called by the public Edge Function only (service_role). Validation lives here so it cannot be bypassed.
create function public.submit_subscription_request(
  p_plan uuid, p_applicant text, p_company text, p_email text, p_phone text, p_utr text, p_receipt_path text,
  p_company_id uuid default null)
returns public.subscription_requests language plpgsql security definer set search_path = '' as $$
declare pl public.plans; r public.subscription_requests;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[[:space:]-]', '', 'g');
  v_utr text := upper(btrim(coalesce(p_utr, '')));
begin
  select * into pl from public.plans where id = p_plan and is_active;
  if not found then raise exception 'PLAN_NOT_AVAILABLE'; end if;
  if length(btrim(coalesce(p_applicant, ''))) not between 1 and 120 then raise exception 'INVALID_NAME'; end if;
  if length(btrim(coalesce(p_company, ''))) not between 1 and 200 then raise exception 'INVALID_COMPANY_NAME'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 254 then raise exception 'INVALID_EMAIL'; end if;
  if v_phone !~ '^\+?[0-9]{10,15}$' then raise exception 'INVALID_PHONE'; end if;
  if v_utr !~ '^[A-Z0-9]{12,22}$' then raise exception 'INVALID_UTR'; end if;
  if p_receipt_path is null or p_receipt_path !~ '^[0-9a-f-]{36}/receipt\.(jpg|png|webp|pdf)$' then raise exception 'INVALID_RECEIPT'; end if;
  if p_company_id is not null and not exists (select 1 from public.companies where id = p_company_id) then raise exception 'COMPANY_NOT_FOUND'; end if;
  begin
    insert into public.subscription_requests (kind, plan_id, plan_name, amount_inr, max_employees, duration_months,
      applicant_name, company_name, email, phone, utr, receipt_path, company_id)
    values (case when p_company_id is null then 'new' else 'renewal' end, pl.id, pl.name, pl.price_inr, pl.max_employees, pl.duration_months,
      btrim(p_applicant), btrim(p_company), v_email, v_phone, v_utr, p_receipt_path, p_company_id)
    returning * into r;
  exception when unique_violation then
    if position('subscription_requests_utr_live' in sqlerrm) > 0 then raise exception 'UTR_ALREADY_USED'; end if;
    raise exception 'REQUEST_ALREADY_PENDING';
  end;
  return r;
end $$;

-- Approve = create company + company_admin role + subscription + mark request approved, all in one transaction.
-- The Edge Function creates the auth user first (p_admin_user) and deletes it again if this raises.
create function public.approve_subscription_request(p_request uuid, p_actor uuid, p_admin_user uuid default null, p_company_code text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.subscription_requests; s public.company_subscriptions; v_company uuid; v_code text; v_base text; i integer := 0;
  v_today date := app.platform_today(); v_from date; v_extend boolean := false;
begin
  if not exists (select 1 from public.user_roles where user_id = p_actor and role = 'super_admin') then raise exception 'FORBIDDEN'; end if;
  select * into r from public.subscription_requests where id = p_request for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.status <> 'pending' then raise exception 'NOT_PENDING'; end if;

  if r.kind = 'new' then
    if p_admin_user is null then raise exception 'ADMIN_USER_REQUIRED'; end if;
    v_base := trim(both '-' from left(regexp_replace(lower(coalesce(nullif(btrim(p_company_code), ''), r.company_name)), '[^a-z0-9]+', '-', 'g'), 24));
    if v_base !~ '^[a-z0-9][a-z0-9_-]{1,31}$' then v_base := 'co'; end if;
    v_code := v_base;
    if nullif(btrim(p_company_code), '') is not null and exists (select 1 from public.companies where code = v_code) then raise exception 'COMPANY_CODE_TAKEN'; end if;
    while exists (select 1 from public.companies where code = v_code) loop
      i := i + 1;
      if i > 8 then raise exception 'COMPANY_CODE_TAKEN'; end if;
      v_code := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
    end loop;
    insert into public.companies (code, name) values (v_code, r.company_name) returning id into v_company;
    insert into public.user_roles (user_id, company_id, role) values (p_admin_user, v_company, 'company_admin');
  else
    v_company := r.company_id;
  end if;

  select * into s from public.company_subscriptions where company_id = v_company;
  -- renewing before expiry extends from the old expiry; a lapsed or complimentary company starts from today
  v_extend := found and not s.is_complimentary and s.expires_on >= v_today;
  v_from := case when v_extend then s.expires_on else v_today end;
  insert into public.company_subscriptions (company_id, plan_id, plan_name, max_employees, starts_on, expires_on, is_complimentary)
  values (v_company, r.plan_id, r.plan_name, r.max_employees, v_today, (v_from + make_interval(months => r.duration_months))::date, false)
  on conflict (company_id) do update set plan_id = excluded.plan_id, plan_name = excluded.plan_name, max_employees = excluded.max_employees,
    starts_on = case when v_extend then public.company_subscriptions.starts_on else v_today end,
    expires_on = excluded.expires_on, is_complimentary = false;

  update public.subscription_requests set status = 'approved', approved_company_id = v_company, reviewed_by = p_actor, reviewed_at = now()
  where id = r.id;
  insert into public.audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
  values (v_company, p_actor, 'SUBSCRIPTION_APPROVED', 'subscription_requests', r.id::text,
          jsonb_build_object('reference', r.reference, 'plan', r.plan_name, 'amount_inr', r.amount_inr, 'utr', r.utr, 'kind', r.kind));
  return v_company;
end $$;

create function public.reject_subscription_request(p_request uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.subscription_requests; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not (select app.is_super_admin()) then raise exception 'FORBIDDEN'; end if;
  if length(v_reason) not between 1 and 300 then raise exception 'INVALID_REASON'; end if;
  select * into r from public.subscription_requests where id = p_request for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.status <> 'pending' then raise exception 'NOT_PENDING'; end if;
  update public.subscription_requests set status = 'rejected', reject_reason = v_reason, reviewed_by = (select auth.uid()), reviewed_at = now() where id = r.id;
  insert into public.audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
  values (r.company_id, (select auth.uid()), 'SUBSCRIPTION_REJECTED', 'subscription_requests', r.id::text,
          jsonb_build_object('reference', r.reference, 'utr', r.utr, 'reason', v_reason));
end $$;

-- Owner override: change an existing company's plan/expiry, or make it complimentary.
create function public.set_company_subscription(p_company uuid, p_plan uuid, p_expires_on date, p_complimentary boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare pl public.plans; v_today date := app.platform_today();
begin
  if not (select app.is_super_admin()) then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from public.companies where id = p_company) then raise exception 'COMPANY_NOT_FOUND'; end if;
  if p_plan is not null then
    select * into pl from public.plans where id = p_plan;
    if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  end if;
  if p_complimentary then
    insert into public.company_subscriptions (company_id, plan_id, plan_name, max_employees, starts_on, expires_on, is_complimentary)
    values (p_company, pl.id, coalesce(pl.name, 'Complimentary'), coalesce(pl.max_employees, 100000), v_today, date '2099-12-31', true)
    on conflict (company_id) do update set plan_id = excluded.plan_id, plan_name = excluded.plan_name, max_employees = excluded.max_employees,
      expires_on = excluded.expires_on, is_complimentary = true;
  else
    if p_plan is null or p_expires_on is null then raise exception 'PLAN_AND_EXPIRY_REQUIRED'; end if;
    insert into public.company_subscriptions (company_id, plan_id, plan_name, max_employees, starts_on, expires_on, is_complimentary)
    values (p_company, pl.id, pl.name, pl.max_employees, least(v_today, p_expires_on), p_expires_on, false)
    on conflict (company_id) do update set plan_id = excluded.plan_id, plan_name = excluded.plan_name, max_employees = excluded.max_employees,
      expires_on = excluded.expires_on, starts_on = least(public.company_subscriptions.starts_on, excluded.expires_on), is_complimentary = false;
  end if;
end $$;

-- ---------------------------------------------------------------- RLS + grants (default privileges deny everything)
alter table public.plans enable row level security;
alter table public.platform_settings enable row level security;
alter table public.subscription_requests enable row level security;
alter table public.company_subscriptions enable row level security;

create policy plans_select on public.plans for select to authenticated using (is_active or (select app.is_super_admin()));
create policy plans_insert on public.plans for insert to authenticated with check ((select app.is_super_admin()));
create policy plans_update on public.plans for update to authenticated using ((select app.is_super_admin())) with check ((select app.is_super_admin()));
create policy plans_delete on public.plans for delete to authenticated using ((select app.is_super_admin()));

create policy platform_settings_select on public.platform_settings for select to authenticated using ((select app.is_super_admin()));
create policy platform_settings_update on public.platform_settings for update to authenticated using ((select app.is_super_admin())) with check ((select app.is_super_admin()));

create policy subscription_requests_select on public.subscription_requests for select to authenticated using (
  (select app.is_super_admin())
  or (company_id is not null and company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin'));

create policy company_subscriptions_select on public.company_subscriptions for select to authenticated using (
  (select app.is_super_admin())
  or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin'));

grant select, insert, update, delete on public.plans to authenticated;
grant select, update on public.platform_settings to authenticated;
grant select on public.subscription_requests, public.company_subscriptions to authenticated;

revoke all on function public.list_public_plans(), public.get_payment_info(), public.my_subscription(),
  public.submit_subscription_request(uuid, text, text, text, text, text, text, uuid),
  public.approve_subscription_request(uuid, uuid, uuid, text),
  public.reject_subscription_request(uuid, text),
  public.set_company_subscription(uuid, uuid, date, boolean) from public, anon, authenticated;
grant execute on function public.list_public_plans(), public.get_payment_info() to anon, authenticated, service_role;
grant execute on function public.my_subscription(), public.reject_subscription_request(uuid, text),
  public.set_company_subscription(uuid, uuid, date, boolean) to authenticated;
grant execute on function public.submit_subscription_request(uuid, text, text, text, text, text, text, uuid),
  public.approve_subscription_request(uuid, uuid, uuid, text) to service_role;
grant execute on function app.platform_today(), app.subscription_state(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- storage
-- receipts: private. Written only by the Edge Function (service_role bypasses RLS), read only by the platform owner.
-- platform-assets: public bucket for the UPI QR image; only the platform owner may write.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('receipts', 'receipts', false, 3145728, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = 3145728,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('platform-assets', 'platform-assets', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = 1048576,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
  end if;
  if to_regclass('storage.objects') is not null then
    create policy receipts_select on storage.objects for select to authenticated using (
      bucket_id = 'receipts' and (select app.is_super_admin()));
    create policy platform_assets_select on storage.objects for select to anon, authenticated using (bucket_id = 'platform-assets');
    create policy platform_assets_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'platform-assets' and name ~ '^qr/[0-9a-f-]{36}\.(png|jpg|webp)$' and (select app.is_super_admin()));
    create policy platform_assets_update on storage.objects for update to authenticated using (
      bucket_id = 'platform-assets' and (select app.is_super_admin()));
    create policy platform_assets_delete on storage.objects for delete to authenticated using (
      bucket_id = 'platform-assets' and (select app.is_super_admin()));
  end if;
end $$;

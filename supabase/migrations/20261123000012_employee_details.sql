-- Round 2: employee details, payroll info, private document storage, monthly leave-request limit.

create table public.company_settings (
  company_id uuid primary key references public.companies (id),
  monthly_leave_request_limit smallint check (monthly_leave_request_limit is null or monthly_leave_request_limit between 0 and 31),  -- null = unlimited
  updated_at timestamptz not null default now()
);
create trigger company_settings_touch before update on public.company_settings for each row execute function app.touch_updated_at();

create table public.employee_profiles (
  employee_id uuid primary key,
  company_id uuid not null,
  photo_path text check (photo_path is null or length(photo_path) <= 200),
  address text check (address is null or length(address) <= 500),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  alt_phone text check (alt_phone is null or alt_phone ~ '^\+[1-9][0-9]{6,14}$'),
  referred_by text check (referred_by is null or length(referred_by) <= 120),
  date_of_birth date check (date_of_birth is null or date_of_birth between date '1900-01-01' and date '2100-01-01'),
  designation text check (designation is null or length(designation) <= 120),
  emergency_name text check (emergency_name is null or length(emergency_name) <= 120),
  emergency_phone text check (emergency_phone is null or emergency_phone ~ '^\+[1-9][0-9]{6,14}$'),
  leave_request_limit_override smallint check (leave_request_limit_override is null or leave_request_limit_override between 0 and 31),
  updated_at timestamptz not null default now(),
  foreign key (employee_id, company_id) references public.employees (id, company_id)
);
create trigger employee_profiles_touch before update on public.employee_profiles for each row execute function app.touch_updated_at();

-- Pay, statutory and identity data: company admins and the employee only (managers cannot read it).
create table public.employee_payroll_info (
  employee_id uuid primary key,
  company_id uuid not null,
  pay_type text not null check (pay_type in ('monthly', 'daily')),
  monthly_salary numeric(12,2) check (monthly_salary is null or monthly_salary >= 0),
  daily_wage numeric(10,2) check (daily_wage is null or daily_wage >= 0),
  pf_eligible boolean not null default false,
  pf_uan text check (pf_uan is null or pf_uan ~ '^[0-9]{12}$'),
  esi_eligible boolean not null default false,
  esi_ip_number text check (esi_ip_number is null or esi_ip_number ~ '^([0-9]{10}|[0-9]{17})$'),
  aadhaar_last4 text check (aadhaar_last4 is null or aadhaar_last4 ~ '^[0-9]{4}$'),   -- the full number is never stored
  aadhaar_path text check (aadhaar_path is null or length(aadhaar_path) <= 200),
  bank_name text check (bank_name is null or length(bank_name) <= 120),
  bank_account text check (bank_account is null or bank_account ~ '^[0-9]{6,20}$'),
  bank_ifsc text check (bank_ifsc is null or bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  updated_at timestamptz not null default now(),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  check ((pay_type = 'monthly' and monthly_salary is not null and daily_wage is null) or (pay_type = 'daily' and daily_wage is not null and monthly_salary is null))
);
create trigger employee_payroll_info_touch before update on public.employee_payroll_info for each row execute function app.touch_updated_at();

create trigger audit_employee_profiles after insert or update or delete on public.employee_profiles for each row execute function app.audit_row();
create trigger audit_employee_payroll_info after insert or update or delete on public.employee_payroll_info for each row execute function app.audit_row();

alter table public.company_settings enable row level security;
alter table public.employee_profiles enable row level security;
alter table public.employee_payroll_info enable row level security;

create policy company_settings_select on public.company_settings for select to authenticated
  using ((select app.is_super_admin()) or company_id = (select app.my_company_id()));
create policy employee_profiles_select on public.employee_profiles for select to authenticated using (
  (select app.is_super_admin())
  or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin')
  or employee_id = (select app.my_employee_id())
  or employee_id in (select app.managed_employee_ids()));
create policy employee_payroll_info_select on public.employee_payroll_info for select to authenticated using (
  (select app.is_super_admin())
  or (company_id = (select app.my_company_id()) and (select app.my_role()) = 'company_admin')
  or employee_id = (select app.my_employee_id()));

do $$
declare admin_chk constant text := '((select app.is_super_admin()) or (company_id = (select app.my_company_id()) and (select app.my_role()) = ''company_admin''))';
  t text;
begin
  foreach t in array array['company_settings', 'employee_profiles', 'employee_payroll_info'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_insert', t, admin_chk);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_update', t, admin_chk, admin_chk);
  end loop;
end $$;
grant select, insert, update on public.company_settings, public.employee_profiles, public.employee_payroll_info to authenticated;

-- ---------------------------------------------------------------- private document bucket
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('employee-docs', 'employee-docs', false, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  end if;
  if to_regclass('storage.objects') is not null then
    -- path = <company_id>/<employee_id>/(photo|aadhaar).<ext>
    create policy employee_docs_select on storage.objects for select to authenticated using (
      bucket_id = 'employee-docs' and (
        (select app.is_super_admin())
        or (split_part(name, '/', 1) = (select app.my_company_id())::text and (select app.my_role()) = 'company_admin')
        or (split_part(name, '/', 1) = (select app.my_company_id())::text and split_part(name, '/', 2) = (select app.my_employee_id())::text)
        or (split_part(name, '/', 3) like 'photo.%' and split_part(name, '/', 2) in (select e::text from app.managed_employee_ids() e))));
    create policy employee_docs_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'employee-docs' and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/(photo|aadhaar)\.(jpg|png|webp|pdf)$'
      and ((select app.is_super_admin()) or (split_part(name, '/', 1) = (select app.my_company_id())::text and (select app.my_role()) = 'company_admin')));
    create policy employee_docs_update on storage.objects for update to authenticated using (
      bucket_id = 'employee-docs'
      and ((select app.is_super_admin()) or (split_part(name, '/', 1) = (select app.my_company_id())::text and (select app.my_role()) = 'company_admin')));
    create policy employee_docs_delete on storage.objects for delete to authenticated using (
      bucket_id = 'employee-docs'
      and ((select app.is_super_admin()) or (split_part(name, '/', 1) = (select app.my_company_id())::text and (select app.my_role()) = 'company_admin')));
  end if;
end $$;

-- ---------------------------------------------------------------- monthly leave-request limit
create or replace function public.apply_leave(p_leave_type_id uuid, p_start date, p_end date, p_half_day boolean default false, p_reason text default null)
returns public.leave_requests language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := (select app.my_employee_id()); v_company uuid; v_tz text; v_today date; lt public.leave_types;
  v_days numeric; v_used numeric; v_limit integer; v_count integer; r public.leave_requests; m record; v_notified boolean := false;
begin
  if v_emp is null then raise exception 'NO_EMPLOYEE' using errcode = '42501'; end if;
  select e.company_id, c.timezone into v_company, v_tz from public.employees e join public.companies c on c.id = e.company_id where e.id = v_emp;
  -- serialise per employee so concurrent requests cannot both pass the balance/overlap checks
  perform 1 from public.employees where id = v_emp for update;
  select * into lt from public.leave_types where id = p_leave_type_id and company_id = v_company and is_active;
  if not found then raise exception 'LEAVE_TYPE_NOT_FOUND'; end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 92 or extract(year from p_start) <> extract(year from p_end)
     or (coalesce(p_half_day, false) and p_start <> p_end) then raise exception 'INVALID_DATES'; end if;
  v_today := (now() at time zone v_tz)::date;
  if p_start < v_today - 30 then raise exception 'DATE_TOO_OLD'; end if;
  if p_end > v_today + 366 then raise exception 'DATE_TOO_FAR'; end if;
  v_days := app.leave_days(v_emp, p_start, p_end, coalesce(p_half_day, false));
  if v_days <= 0 then raise exception 'NO_WORKING_DAYS'; end if;
  select coalesce(p.leave_request_limit_override, s.monthly_leave_request_limit) into v_limit
    from (select 1) x left join public.employee_profiles p on p.employee_id = v_emp
    left join public.company_settings s on s.company_id = v_company;
  if v_limit is not null then
    select count(*) into v_count from public.leave_requests
      where employee_id = v_emp and status in ('pending', 'manager_approved', 'approved') and date_trunc('month', start_date) = date_trunc('month', p_start);
    if v_count >= v_limit then raise exception 'LEAVE_LIMIT_REACHED'; end if;
  end if;
  if lt.annual_quota_days is not null then
    select coalesce(sum(days), 0) into v_used from public.leave_requests
      where employee_id = v_emp and leave_type_id = lt.id and status in ('pending', 'manager_approved', 'approved')
        and extract(year from start_date) = extract(year from p_start);
    if v_used + v_days > lt.annual_quota_days then raise exception 'INSUFFICIENT_BALANCE'; end if;
  end if;
  begin
    insert into public.leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, is_half_day, days, reason)
      values (v_company, v_emp, lt.id, p_start, p_end, coalesce(p_half_day, false), v_days, nullif(btrim(p_reason), ''))
      returning * into r;
  exception when exclusion_violation then raise exception 'LEAVE_OVERLAP'; end;
  for m in select manager_employee_id from public.manager_assignments where employee_id = v_emp loop
    perform app.notify_leave(v_company, m.manager_employee_id, 'New leave request', lt.name || ' ' || p_start || ' to ' || p_end, r.id); v_notified := true;
  end loop;
  if not v_notified then perform app.notify_leave(v_company, null, 'New leave request', lt.name || ' ' || p_start || ' to ' || p_end, r.id); end if;
  return r;
end $$;

-- How many leave requests (not rejected/cancelled) the caller has with a start date in the given month, and the limit that applies.
create function public.leave_request_usage(p_year integer, p_month integer)
returns table (limit_per_month integer, used integer) language sql stable security definer set search_path = '' as $$
  select coalesce(p.leave_request_limit_override, s.monthly_leave_request_limit)::integer,
    (select count(*)::integer from public.leave_requests r where r.employee_id = (select app.my_employee_id())
       and r.status in ('pending', 'manager_approved', 'approved')
       and extract(year from r.start_date) = p_year and extract(month from r.start_date) = p_month)
  from (select 1) x
  left join public.employee_profiles p on p.employee_id = (select app.my_employee_id())
  left join public.company_settings s on s.company_id = (select app.my_company_id())
$$;
revoke all on function public.leave_request_usage(integer, integer) from public, anon;
grant execute on function public.leave_request_usage(integer, integer) to authenticated;

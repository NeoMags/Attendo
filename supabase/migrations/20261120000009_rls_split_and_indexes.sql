-- Replace single FOR ALL write policies with per-command policies so SELECT evaluates exactly one policy
-- (clears the multiple_permissive_policies advisories). Access rules are unchanged.
do $$
declare t text;
  admin_chk constant text := '((select app.is_super_admin()) or (company_id = (select app.my_company_id()) and (select app.my_role()) = ''company_admin''))';
begin
  foreach t in array array['departments', 'geofences', 'shifts', 'manager_assignments'] loop
    execute format('drop policy %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_insert', t, admin_chk);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_update', t, admin_chk, admin_chk);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_delete', t, admin_chk);
  end loop;
end $$;

drop policy companies_write_super on public.companies;
create policy companies_insert on public.companies for insert to authenticated with check ((select app.is_super_admin()));
create policy companies_update on public.companies for update to authenticated using ((select app.is_super_admin())) with check ((select app.is_super_admin()));
create policy companies_delete on public.companies for delete to authenticated using ((select app.is_super_admin()));

-- system_settings: super admin may write any row; a company admin only rows of their own company (never global rows).
drop policy system_settings_write_company on public.system_settings;
drop policy system_settings_write_super on public.system_settings;
do $$
declare chk constant text := '((select app.is_super_admin()) or (company_id is not null and company_id = (select app.my_company_id()) and (select app.my_role()) = ''company_admin''))';
begin
  execute format('create policy system_settings_insert on public.system_settings for insert to authenticated with check (%s)', chk);
  execute format('create policy system_settings_update on public.system_settings for update to authenticated using (%s) with check (%s)', chk, chk);
  execute format('create policy system_settings_delete on public.system_settings for delete to authenticated using (%s)', chk);
end $$;

-- Only FKs whose parent rows can actually be deleted by a client need a supporting index (departments, shifts,
-- geofences are admin-deletable; employees/attendance/sessions are never deleted, so their FK indexes would only add write cost).
create index if not exists employees_department on public.employees (department_id, company_id) where department_id is not null;
create index if not exists employees_shift on public.employees (shift_id, company_id) where shift_id is not null;
create index if not exists geofence_state_geofence on public.geofence_state (geofence_id);

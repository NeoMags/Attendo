-- Attendo 007: service_role (Edge Functions) inserts employees; the default value must not need
-- direct privileges on app.login_phone_seq. Found during live test of admin-create-employee.
create or replace function app.next_login_phone() returns text
language sql security definer set search_path = '' as
  $$ select '+999' || nextval('app.login_phone_seq')::text $$;
revoke execute on function app.next_login_phone() from public, anon, authenticated;
grant execute on function app.next_login_phone() to service_role;

# Supabase backend

## Contents
- `migrations/` ordered SQL (001 foundation, 002 tracking tables, 003 geofencing/misc, 004 RPCs, 005 RLS + grants)
- `functions/` Edge Functions: `employee-login`, `admin-create-employee`, `admin-reset-password` (source only, not yet deployed)
- `tests/` + `run_tests.sh` SQL test suite (runs on a local Postgres 16 + PostGIS with a Supabase shim)

## Run the tests locally
Needs a local Postgres 16 with PostGIS (`postgresql-16-postgis-3`) listening on `PGHOST/PGPORT` (default `/tmp`, `54329`).
```
./run_tests.sh      # exits non-zero on any failure; prints every PASS/FAIL
```
The shim in `tests/00_supabase_shim.sql` is test-only. Never apply it to a real project.

## Apply to the Attendo project (Phase 2, pending project access)
1. Auth > Providers: enable **Phone** (no SMS provider needed: users are created by the admin function with `phone_confirm: true`; OTP flows are not used).
2. Apply migrations in order (Supabase CLI `supabase db push`, or the SQL editor).
3. Enable `pg_cron` (Database > Extensions) if migration 004 printed the notice, then:
   `select cron.schedule('attendo_partitions','0 2 20 * *','select app.ensure_location_partitions(1,3)');`
   `select cron.schedule('attendo_purge','30 2 * * *','select app.purge_expired()');`
4. Deploy functions: `supabase functions deploy employee-login --no-verify-jwt`; `supabase functions deploy admin-create-employee`; `supabase functions deploy admin-reset-password`.
5. Bootstrap the first Super Administrator (one-time, SQL editor as `postgres`):
   - Auth > Users > Add user (email + password) for yourself, copy its UUID.
   - `insert into public.user_roles (user_id, company_id, role) values ('<uuid>', null, 'super_admin');`
6. Create a company: `insert into public.companies (code, name) values ('tatva', 'Tatva');` then create admins/employees via the functions (never by hand: they must be linked to an auth user).

## Login model
Employee ID + company code -> `employee-login` -> `resolve_employee_login()` (service_role only) -> internal phone `+999XXXXXXXXXXX` -> `signInWithPassword({phone, password})`. No SMS is ever sent. 5 failed attempts per identifier / 15 min and 30 per IP are throttled (HTTP 429). Password reset is admin-mediated.

## Error codes returned by RPCs (message prefix)
`DUPLICATE_CHECKIN, OVERLAPPING_ATTENDANCE, ACCURACY_TOO_LOW, TIMESTAMP_IN_FUTURE, TIMESTAMP_TOO_OLD, DEVICE_NOT_REGISTERED, DEVICE_LIMIT_REACHED, DEVICE_BLOCKED, SESSION_NOT_FOUND, ATTENDANCE_NOT_FOUND, CHECKOUT_BEFORE_CHECKIN, BATCH_TOO_LARGE, INVALID_PAYLOAD, FORBIDDEN, EMPLOYEE_NOT_FOUND`.
`ingest_locations` never errors per record: it returns `{accepted, duplicates, rejected:[{id, reason}]}`.

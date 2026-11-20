# PROJECT_STATUS

Last updated: 2026-11-20

## Decisions (user-confirmed 2026-11-20)
Metrics-only productivity report · Employee ID login mapped to internal phone · applicationId `com.tatva.attendo` · Maps key and Firebase project to be supplied by user

## Phase 1: Architecture and initialization: COMPLETE
## Phase 2: Supabase database and authentication: CODE COMPLETE, NOT YET APPLIED TO THE ATTENDO PROJECT
Done
- 5 migrations (20 tables, enums, partitioned GPS table, RLS, grants, 9 RPCs, retention, audit)
- SQL test suite: 149/149 pass on local Postgres 16 + PostGIS 3.4 (Supabase shim)
- Edge Functions written and type-checked (`employee-login`, `admin-create-employee`, `admin-reset-password`)
- `supabase/README.md` apply + bootstrap steps

Blocked
- Attendo project (org DMTNEO1) is not visible to the Supabase connector (sees only org DMTNEO1). Needs connector re-authorized for DMTNEO1, or the CLI route with a token/DB password supplied by the user.

Not verified yet (needs the real project)
- Migrations on hosted Postgres 17 (only tested on Postgres 16)
- Phone + password sign-in with admin-created internal phone numbers and no SMS provider
- Edge Functions executed (Deno not available here)
- Supabase advisors (security/performance) results
- Realtime delivery of `employee_live_status`

## Pending
Phases 3-11

## Phase 2 – verified on hosted project (2026-11-20, ref ehwlqttwkmbgfttqvtcd, org DMTNEO1)
- Migrations 001–006 applied; security advisor: only intentional warnings; live smoke test (rolled back) passed.
- Phone provider enabled with placeholder Twilio values, phone confirmations off, sign-ups off (user-confirmed).
- Edge Functions deployed: employee-login (verify_jwt=false, throttled), admin-create-employee, admin-reset-password (verify_jwt=true).
  Deployed copies import `./common.ts` (flat); repo copies import `../_shared/common.ts`. Keep both in sync.
- employee-login verified live: success, wrong password 401, lockout 429. admin-* NOT yet executed (need a super admin).
- Note: GoTrue stores phones without '+'; users must be created through Auth admin API (admin-create-employee), not raw SQL.
- Deferred to Phase 10: 36 unindexed composite FKs, split `for all` policies (multiple_permissive_policies).
- 2026-11-20: super admin bootstrapped (neomags@gmail.com, role super_admin). Migration 007 (service_role sequence fix) applied; local tests 151/151.
- admin-create-employee / admin-reset-password verified live: create 201, dup 409, weak pw 400, employee token 403, reset ok, old pw rejected, new pw accepted, company_id override ignored for company_admin.

## Phase 3 - Android foundation (verified)
- `android/`: single :app module, package com.tatva.attendo, minSdk 26, compile/target 35. AGP 8.13.2, Kotlin 2.4.21, Gradle 8.14.3.
- Library versions pinned BELOW latest (compose BOM 2025.09.00, activity 1.10.1, core 1.16.0, appcompat 1.7.1, lifecycle 2.9.4, okhttp 4.12.0): latest androidx/okhttp 5.x need AGP 9.1+/compileSdk 37.
- Implemented: employee-id login, forced password change, token refresh (single-flight), Keystore-encrypted session, check-in/out with idempotent pending retry, mock-location + accuracy guard, en/kn/hi UI.
- Verified: `assembleDebug` OK; 40/40 JVM unit tests; lint 0 errors (22 warnings, mostly newer-version notices). Live against hosted project via curl with the exact request shapes: login, profile, change-password (+same_password error), refresh, get_tracking_config, register_device, check_in (+idempotent retry, DUPLICATE_CHECKIN), open-attendance read, check_out (+retry).
- NOT verified (no device/emulator): Compose UI, Keystore store, Fused location, permission flow, locale switching.
- Lint found+fixed: Location.isMock is API 31+ (would crash on Android 8-11).
- Test user was created with raw SQL; real users must use admin-create-employee (which also writes user_roles - required for the employee to read their company row).
- Test cleanup needed `session_replication_role=replica` (attendance is immutable); orphan audit_logs rows remain by design.

## Phase 4 - GPS tracking, offline queue, device health (verified where stated)
- Room 2.7.2 (KSP 2.3.14) queue `queued_location`; WorkManager 2.10.1 (15-min safety-net sync + one-shot final flush).
- `tracking/`: TrackingService (foreground, type location), LocationUploader (batches, idempotent ids, poison-batch handling), IntervalPolicy (moving/stationary from server settings), HeartbeatReporter + HealthSnapshot, BootReceiver, SyncScheduler.
- Tracking starts at check-in capture (even offline), stops at check-out; queued points still upload. loadToday reconciles with server (resume after reinstall via tracking_sessions lookup; stop if shift closed).
- Verified: build, 65/65 JVM tests, lint 0 errors. Live: ingest (accept/duplicate/reject reasons, after-checkout, AFTER_SESSION_END), heartbeat statuses (degraded/interrupted), DEVICE_NOT_REGISTERED, report_interruption, session lookup.
- NOT verified (needs device): service lifecycle, Fused updates, battery-saver/OEM killing, boot resume, permission banners, notification, WorkManager scheduling.
- Gradle builds can hit Maven Central 429s on first download of new deps; rerun with --max-workers=2.

## Phase 6 — Web dashboard (core)
- Built: login, role-aware layout, overview, employees (add/reset/deactivate), attendance (date range + CSV), departments & shifts, companies (+ company-admin creation). Edge Functions got CORS; new `admin-create-company-admin`.
- Verified: `tsc -b` clean, `vite build` OK, vitest 8/8 (csv injection, duration, role nav, geo).
- NOT verified: any browser behaviour; admin Edge Functions with a real admin JWT; RLS paths from the UI.
- Pending: Maps key (Phase 7), Vercel deploy (needs go-ahead).

## Phase 7 — Live map
- Built: `pages/LiveMap.tsx`, `lib/livemap.ts` (+tests). Polls `employee_status_v` every 15 s (Realtime not used). Pins coloured by health/staleness; table fallback when no Maps key.
- Verified: tsc, vite build, vitest 10/10; view columns confirmed against live DB.
- NOT verified: Google map rendering (no key, no browser), marker behaviour with real data.
- Live DB observation: E001 is checked in with no location points.

## Phase 8 — Route history, playback, analytics
- Built: `lib/route.ts` (clean track, distance, stop detection, SVG projection), `pages/Routes.tsx` (employee+date, KPIs, playback slider, stops, interruptions, Google polyline or SVG fallback), `lib/analytics.ts` + `pages/Analytics.tsx` (present/late per day, average hours; Recharts).
- Thresholds (my choices, tunable): accuracy >100 m dropped; >70 m/s jump dropped; stop = within 50 m for 5+ min; gaps >20 min not counted as movement.
- Verified: tsc, vite build, vitest 18/18 (incl. 7 route + 1 analytics).
- Live DB: a real phone session has 7 points (13:31–13:37 UTC, avg accuracy 22 m, not mock, ~6 m spread = stationary). Device tracking works in the foreground/while the app is open; movement, screen-off, app-kill and reboot behaviour still unverified.
- NOT verified: Routes/Analytics pages in a browser; Google polyline rendering; paging beyond 1000 points.

## Phase 9 — Reports & exports
- DB: migrations `…008_productivity_report.sql` (+ live fix `productivity_report_fix_variable_conflict`; repo file already has the `#variable_conflict use_column` fix). `public.productivity_report(company, from, to)` SECURITY INVOKER (RLS applies), max 92 days, execute granted to authenticated/service_role only. Metrics only: days present, late days, worked, tracked time, distance, points, interruptions. No score/ranking.
- Web: `lib/reports.ts`, `pages/Reports.tsx` — Attendance summary, Daily attendance, Field activity metrics; CSV (BOM, formula-safe), Excel (exceljs, text cells), PDF (jsPDF+autotable); exporters lazy-loaded.
- Verified: live call returns correct shape on real data (E001: 8 points, 21.5 m); anon blocked, authenticated allowed; vitest 26/26 incl. real xlsx round-trip and PDF header check; tsc and vite build clean.
- NOT verified: Reports UI in a browser/download behaviour; RLS scoping of the RPC for manager/company_admin callers (not tested with real users); PDF Kannada/Hindi glyphs (default font lacks them — known limitation); large-company performance.
- Dependency note: `npm audit` reports 2 moderate (uuid via exceljs; advisory concerns v3/v5/v6 with a buffer arg — not used by exceljs v4 paths as far as I know; unverified).

## Phase 10 — Security, performance, hardening (database + web; Android items deferred)
- Advisors (live): security = 9 SECURITY DEFINER client RPCs executable by `authenticated` (intentional; each re-checks caller/role internally — `admin_correct_attendance` and `log_admin_access` read and confirmed), 2 service-only tables with RLS and no policy (`geofence_state`, `login_attempts`; intentional), leaked-password protection OFF (Supabase Auth dashboard setting; Pro plan feature — user action).
- Migration 009: per-command write policies (clears 9 multiple_permissive_policies warnings; access rules unchanged); 3 FK indexes for admin-deletable parents. Remaining 33 unindexed-FK infos are by design (employees/attendance/sessions are never client-deleted; extra indexes would only slow GPS writes).
- Tests: local SQL suite 178/178 (was 151; +27 in `tests/50_rls_write_policies.sql`: cross-company writes, manager/employee denial, global settings, report scoping/limits, anon denied). Live smoke: super admin insert under new policies OK (rolled back).
- Web: routes lazy-loaded (initial JS 524 kB / ~155 kB gz; Analytics 455 kB and Excel 929 kB load only on use); route views write `log_admin_access('route_history')`; `vercel.json` SPA rewrite + security headers (no CSP yet — untested against Google Maps, would need browser verification).
- Known gaps: CORS on admin Edge Functions is `*` (tokens travel in headers, not cookies; tighten to the dashboard origin after deploy); analytics thresholds are hard-coded in web/SQL while `analytics.*` settings exist in the DB (inconsistency, to unify); company-wide report exports are not individually audit-logged (`log_admin_access` is per employee).
- Deferred Android: queue size cap, poor-signal behaviour, Room migration tests.

## Deployment (dashboard)
- Repo: https://github.com/NeoMags/Attendo (branch `main`). Vercel project `attendo-dashboard` (root `web`, Vite), auto-deploys on push.
- Live URL: https://attendo-dashboard.vercel.app (production deployment READY; page itself not opened from this environment). Env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (publishable). Maps key not set yet.

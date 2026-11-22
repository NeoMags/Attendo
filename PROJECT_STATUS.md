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

## Dashboard additions (post-Phase 10)
- Geofences page (list/add/toggle; admin write, manager read), Manager teams page (assign/remove employees; admin only), Device health page (fleet from employee_status_v, 30 s refresh), Attendance correction modal (admin; calls admin_correct_attendance; company-timezone inputs via lib/tz.ts).
- Not done: map picker for geofences, geofence event view, edit/delete geofence. Not verified in a browser or with a real admin/manager login.

## UI upgrade round (reference-inspired, additive)
- Amber accent, grouped sidebar (Monitor / People / Setup), icon stat cards, avatars, skeleton loading.
- New: Attendance calendar page, Geofence alerts page (reads geofence_events), Employee side panel (day summary, distance, battery; writes a route_history audit entry), Under/Over columns on Attendance + CSV (computed vs shift length; unpaid breaks not modelled), "Not in yet" stat on Overview. Routes page now accepts ?emp=&date=.
- Tests: lib/worktime.test.ts (6). Total vitest 38. Not verified in a browser; the geofence_events embeds (employees, geofences) are unverified against live PostgREST.
- Not done: Leave, shift roster, payroll, claims, appraisal, applicant tracking, Wi-Fi restriction, push notifications.

## Leave management (round 1: backend + dashboard)
- Migration `20261122000010_leave_management.sql` (applied live): leave_types (yearly quota, null = unlimited), leave_requests (status pending → manager_approved → approved | rejected | cancelled; overlap blocked by exclusion constraint), RPCs apply_leave / decide_leave / cancel_leave / leave_balances. Clients cannot write leave_requests directly. Status changes audit-logged; notifications rows created (not pushed yet).
- Tests: supabase/tests/60_leave.sql (55). SQL total 233/233 locally. Live smoke test (rolled back): apply, self-decide blocked, visibility, balance verified.
- Dashboard: Leave page (queue, approve, reject with reason, leave types for admins); approved leave shows on Attendance calendar and Overview ("Not in yet" excludes on-leave).
- Rules: balance counts pending + approved days per calendar year; requests cannot span years; max 92 days; up to 30 days back, 366 ahead; working days follow the employee's shift (Mon–Sat if none). Holidays, carry-forward, accrual, admin cancel of approved leave: not built.
- Not done: Android apply/cancel/balance screens, push of leave notifications (needs Firebase), concurrency stress test.

## Leave management (round 2: Android)
- App v0.5.0 (code 5): Home → "Leave" opens balances (yearly, per type), apply form (type, start/end date pickers, half day, reason ≤500) and My requests with Cancel (confirm dialog). Client pre-checks mirror server rules; the server (`apply_leave`/`cancel_leave`) stays authoritative. Strings EN/HI/KN (HI/KN leave text needs native-speaker review).
- Tests: 82 JVM unit tests pass (17 new: rules, repository, 6 API/MockWebServer). Not verified: UI on a real phone/emulator, leave notifications (stored only, not pushed).

## Round 1 (clock, bell, exit alerts, field schedule, custom cards)
- DB (live, migration 20261123000011): `user_prefs` (notification seen time + dashboard card layout, own-row RLS), `geofences.alert_on_exit`, trigger creating an admin notification on every confirmed geofence exit (managers see their team's only), `field_schedules` (admin/manager write, employee read own). Local SQL suite 249/249.
- Web: header live day/date/time (company zone) + bell (unread badge, realtime INSERT subscription, mark all read); Overview cards add/remove/replace/reorder per user with 10-card catalogue (incl. Absent), 7-day chart, recent exits; Field schedule calendar (month grid, day list, visit verified by geofence entry); per-geofence exit-alert toggle. Vitest 46/46.
- Android 0.6.0: live clock/date + bell with unread count on Home, notifications screen (polled every 60 s while the app is open). No phone push yet (needs Firebase). 
- Not verified: web pages in a browser, realtime delivery live, Android on a device.

## Round 2 (employee onboarding + self-service)
- DB (live, migration 20261123000012): `employee_profiles` (photo, address, phones, referred by, DOB, designation, emergency contact, per-employee leave-request limit), `employee_payroll_info` (monthly/daily pay, PF/UAN, ESI/IP, Aadhaar last-4 + image path, bank; admins + the employee only, managers excluded), `company_settings` (monthly leave-request limit), private `employee-docs` bucket (2 MB, jpg/png/webp/pdf) with company-scoped policies (managers see team photos only), `apply_leave` enforces the limit (LEAVE_LIMIT_REACHED), `leave_request_usage` RPC. SQL suite 278/278 (shim now emulates storage).
- Web: Employees -> Details (photo/Aadhaar capture or upload with client-side compression, Verhoeff-checked Aadhaar number - only last 4 digits stored, phone normalisation, pay, PF/ESI, bank, leave override); new employee opens Details right after creation; Leave page has the company monthly limit. Vitest 53/53.
- Android 0.7.0: Home -> My details (photo, contact, pay/PF/ESI, Aadhaar last 4, 30-day attendance), leave usage line, limit error message. Transactions section is a placeholder until payroll.
- Not verified: browser camera/upload flow on a real phone, storage upload against the live bucket, Android on a device. Hindi/Kannada strings need native review.

## Round 3: tasks (v0.8.0) + fixes
- Aadhaar input: digits-only live formatting, "n of 12 digits" hint; checksum mismatch is now a warning (can still save).
- Leave: approver chooses Paid/Unpaid on final approval (`leave_requests.is_paid`, `decide_leave(..., p_paid)`); weekly off = untick day in a shift's working days (`shifts.working_days`).
- Tasks: table `tasks` (one-level subtasks via parent_id), per-task/subtask assignee, status todo/in_progress/submitted/rework/approved/cancelled. Writes only via RPCs create_task/update_task/cancel_task/set_task_progress/review_task. Parent can't be submitted/approved while subtasks are open. Notifications kind 'task'.
- Web: Tasks page (create, subtasks, edit, cancel, approve, send back). Android: "Tasks" screen (start / submit with note). Tests: SQL 322, web 59, Android 102.

## Round 4: payroll core (v0.9.0)
- DB (migration 20261123000015, applied live): company_holidays, payroll_runs, payslips, employee_advances, advance_recoveries, ledger_entries, advance_balances view, payslip_templates; admin-only RPCs generate_payroll, set_payslip_adjustment, finalize_payroll, mark_payslip_paid, give_advance. SQL tests 364/364.
- Rules: working days = month days on the employee's shift working_days (weekly off per shift). Present > holiday > leave (paid/unpaid) > absent. Monthly: salary x (present+holiday+paid leave)/working days. Daily wage: wage x (present+paid leave), holidays unpaid. Advances recovered oldest first up to the monthly installment, capped at pay; 0 pay => carried over.
- Web: /payroll (admin only): monthly run (generate/adjust/finalize/mark paid, PDF download + print), advances, holidays, templates, per-employee account statement. 64 vitest pass incl. real PDF generation.
- Android: Payslips & transactions screen (My details -> button): finalized payslips with PDF share/print, advances, ledger. 107 unit tests pass. PDF rendering (PdfDocument), share sheet and print are NOT run on a device.
- Open: PDF uses "Rs."; no void/reverse of advances; half-day attendance not modeled; payroll web UI not viewed in a browser.

## Round 4 follow-ups (v0.10.0)
- Half-day attendance: shifts have optional `full_day_minutes` / `half_day_minutes`; worked time maps to 1 / 0.5 / 0 per day; admin can override a day's value (Attendance correction modal). Payroll counts fractions.
- Advances can be voided/written off (remaining balance only; recoveries already made on finalized payslips are not reversed).
- Shifts can be edited/deleted (Setup). Paid leave counts as paid. Holidays: Payroll -> Holidays tab (a holiday is excluded from working days; migration 19).
- Payslip PDFs in English/Hindi/Kannada on web (pdfmake + Noto fonts in web/public/fonts) and Android (string-resource labels, system fonts).

## Round 5: statutory (v0.11.0)
- Migration 17: `statutory_params` (versioned rates, each with `verified` + `source`), `employee_payroll_info.eps_eligible`, `statutory_filings`, RPCs `statutory_contributions`, `statutory_summary`, `record_statutory_filing`.
- Migration 18: `tax_slabs`, `tax_declarations`, RPCs `save_tax_declaration`, `tax_projection`, `tax_projection_all` (+ app.tax_breakdown / tax_scenario). Projection only: payslips do NOT deduct TDS.
- Web: Payroll -> "PF / ESI" (summary, ECR `#~#` file, ESI CSV, payment record) and "Income tax" (projection table + declaration editor). Employee form has an EPS flag.
- Android: My details -> "Income tax declaration" (projection + declaration form).
- Tests: SQL 443/443, web 74, Android 113.
- Verified from official pages: PF ceiling Rs 25,000 from 17-Sep-2026 (S.O. 5109(E)); ESI ceiling Rs 21,000 and 0.75%/3.25%; new-regime slabs (s.202), 87A/156 rebate (new: Rs 60,000 up to Rs 12L, with marginal relief; old: Rs 12,500 up to Rs 5L), standard deduction Rs 75,000 new / Rs 50,000 old.
- NOT verified (flagged `verified=false` in tables): PF 12/8.33/0.5/0.5% split, ESI Rs 176/day exemption, ESI round-up rule, ESIC upload CSV headers, day-weighted PF ceiling for Sept 2026, old-regime slabs for 2026-27, cess 4%, 80C/80D/home-loan caps.
- Not modelled: surcharge, senior-citizen slabs, PAN-missing higher TDS, HRA calculation, EPF voluntary higher wages, ESI contribution-period continuity, admin-charge minimum.

## Advance reversal (v0.11.1, migration 20)
- `reverse_advance_recovery(payslip, reason)`: admin-only, finalized + unpaid payslip only. Marks that payslip's recoveries reversed, sets advance_deduction=0 and net=gross+bonus-other, restores the advance balance (recovered again in a later month), ledger kind `advance_reversed`, employee notified. Errors: PAYSLIP_NOT_FOUND, FORBIDDEN, RUN_NOT_FINALIZED, ALREADY_PAID, NOTHING_TO_REVERSE.
- Already-paid payslips cannot be reversed (would double-charge); cash-refund flow not built.
- Fix: `advance_recoveries` select policy now lets the employee read own recoveries (their "remaining" was showing the full advance).
- Web: "Reverse recovery" button on unpaid finalized rows (Run tab); statement label. Android: statement label (EN/HI/KN).
- Tests: SQL 456/456 local; web vitest 74/74, tsc clean, build OK; Android unit tests + assembleDebug OK.

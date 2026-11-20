# Attendo — Architecture (Phase 1)

Status of each item: **[spec]** from your original prompt, **[new]** requested in your follow-up, **[proposed]** my addition, needs your approval.

## 1. Components

```
Android app (Kotlin/Compose) ──HTTPS──► Supabase (Auth, PostgREST, Realtime, Edge Functions, Storage)
  Room queue + WorkManager                  PostgreSQL + PostGIS + RLS
  Foreground location service                    ▲
  Device health reporter [new]                   │ Realtime + PostgREST (anon key + user JWT)
                                          React admin dashboard (Vite/TS/Tailwind/shadcn)
FCM ◄── Edge Function (server-only secrets) ──────┘
```

No service-role key ever ships in the APK or the web bundle. Privileged work (creating employees, FCM sends, report generation, health alerts) runs in Edge Functions.

## 2. Data flow for tracking

Check-in → `attendance` row + `tracking_sessions` row → foreground service writes each fix to Room → WorkManager/worker uploads batches via an idempotent RPC `ingest_locations(session_id, batch jsonb)` → `location_records` (`recorded_at` = device fix time, `received_at` = server `now()`; never overwritten) → Realtime to dashboard.

Idempotency: client-generated UUID per record (`id`), `INSERT … ON CONFLICT (id) DO NOTHING`. Same for attendance events.

## 3. Features requested in follow-up

| Feature | Status | Design |
|---|---|---|
| Geofencing | [spec] + [new] emphasis | `geofences` (PostGIS point + radius, type, active hours). Entry/exit computed **server-side** from `location_records` with hysteresis (N consecutive fixes, and accuracy must be ≤ radius) so GPS jitter is not treated as proof. Dwell time from event pairs. |
| Attendance | [spec] | `attendance` with shift state machine: `open → closed`. Partial unique index on `(employee_id) WHERE status='open'` blocks duplicate check-ins at DB level. Finalized rows immutable for clients via RLS + trigger. |
| Route playback | [spec] + [new] | Dashboard replays `location_records` ordered by `recorded_at`; speed 1×–32×; gaps > threshold drawn dashed and labelled "no data", never interpolated. |
| Device health monitor | [new] | See §4. |
| Employee productivity report | [new] | See §5. |

## 4. Device health monitor [new]

Purpose: tell an admin *why* tracking is degraded, and tell the employee how to fix it.

Android sends a heartbeat (every 5 min while tracking, plus on state change) into `device_health_snapshots`:

- battery %, charging, power-saver on
- location permission level (fine / coarse / background granted / denied), location services on, provider (GPS/network/fused)
- notification permission, battery-optimisation exemption status
- network type (wifi/cell/none), pending queue size, oldest unsynced record age
- app version, OS version, device model
- **mock-location flag** and device clock drift vs server (integrity signals) [proposed]
- foreground-service alive, last location fix time

Server derives a status per device: `healthy | degraded | offline | interrupted`, using configurable thresholds in `system_settings`. Heartbeat gaps are recorded as `tracking_interruptions` (reason: `gps_off | permission_revoked | service_killed | no_heartbeat | low_battery | unknown`). A missing heartbeat is reported as **"unknown — no data"**, never assumed to be a cause.

Dashboard: fleet health table (filter by status), per-device timeline, alert list. Employee app shows a checklist with fix-it buttons. FCM can nudge an employee ("GPS is off") — [proposed], needs your approval.

## 5. Employee productivity report [new]

Constraint from your spec: GPS cannot tell what someone is doing. So this report measures **observable, recorded facts** and does not claim to measure "productivity" itself.

Per employee per day / month, all derived from recorded data:

1. Punctuality: check-in vs shift start (late minutes)
2. Attendance duration: check-in → check-out
3. Tracking coverage: % of shift with valid fixes (gaps excluded, shown separately)
4. Distance (estimated, from filtered points)
5. Stationary vs moving time
6. Geofence visits: count, dwell time per zone type (customer / site / office)
7. Interruptions: count and total minutes, by reason
8. Device health: % of shift in healthy state

**Composite score is optional and off by default** [proposed]. If enabled, weights are admin-configurable, the formula is shown to the employee, and the report labels coverage-limited days as "insufficient data" rather than scoring them low. Reason: a hidden score built from GPS alone can unfairly penalise people with poor network or old phones, and a desk-based or in-meeting employee looks "stationary".

Employees can see their own report (transparency, matches the "no stealth tracking" rule).

Exports: PDF, Excel, CSV (spec §10).

Legal note (unverified — needs confirmation): employee location monitoring in India is likely subject to the Digital Personal Data Protection Act 2023 (notice and consent, purpose limitation). Get a lawyer's confirmation before production use.

## 6. Schema (spec §7 tables + additions)

Spec tables: companies, employees, departments, user_roles, employee_devices, attendance, tracking_sessions, location_records, geofences, geofence_events, notifications, audit_logs, system_settings.

[new] additions:
- `device_health_snapshots` (device_id, employee_id, company_id, captured_at, received_at, payload columns above)
- `tracking_interruptions` (session_id, started_at, ended_at, reason, source: `device_reported | server_inferred`)
- `productivity_daily` (employee_id, date, metrics columns, `computed_at`, `formula_version`) — materialised by a scheduled job so reports are fast; recomputable from raw data
- `shifts` / `work_schedules` (needed for "late" and coverage %) [proposed]
- `managers_employees` assignment table (needed for the Manager role) [proposed]

All tenant tables carry `company_id`; RLS policies key off a `SECURITY DEFINER` helper reading the caller's company and role from `user_roles`, never from client-supplied claims.

## 7. Key decisions

| # | Decision | Reason |
|---|---|---|
| D1 | Monorepo: `android/`, `web/`, `supabase/` | One status file, shared docs |
| D2 | Employee login = company code + Employee ID, mapped server-side to an internal phone (`+999` + 11 digits, non-routable) used as the Supabase Auth phone with a password. **Decided with user 2026-11-20.** | Spec asks for Employee ID login; Supabase Auth requires email or phone. No SMS involved. Phone+password without SMS confirmation is documented by Supabase but **unverified on the real project**. |
| D3 | Foreground service type `location`; background location permission only if needed | A foreground service started from a visible check-in does not need `ACCESS_BACKGROUND_LOCATION` to keep receiving updates on current Android. Will verify against current docs in Phase 4 before relying on it. |
| D4 | Distance/geofence math server-side in SQL (PostGIS) plus TS mirror for the dashboard | Single source of truth for reports |
| D5 | Web uses Tailwind v4 + shadcn/ui, React 19, Vite 8, TS 7 | Current stable versions installed in this environment |
| D6 | Realtime for live map; polling fallback | Realtime can drop; stale data is labelled "last seen X ago" |
| D7 | Android release signing via keystore outside the repo | Spec §15 |
| D8 | Productivity report is **metrics only**; no composite score column exists. **Decided with user 2026-11-20.** | Avoids unfair opaque scoring from GPS alone |
| D9 | Android applicationId `com.tatva.attendo`, app name "Attendo". **Decided with user 2026-11-20.** | Org Tatva + app Attendo |
| D10 | GPS table partitioned monthly by `recorded_at`; live map subscribes to the one-row-per-employee `employee_live_status`, not to GPS rows | Cheap retention; Realtime load independent of fix volume |
| D11 | Clients have SELECT only (RLS-filtered). All writes of attendance/GPS/health go through SECURITY DEFINER RPCs that derive identity from `auth.uid()`; finalized attendance and GPS rows are immutable via triggers | Spec §7/§9 |

## 8. Android limitations to report honestly

- OEM battery managers (Xiaomi, Oppo, Vivo, Samsung) can kill foreground services. We detect the gap, record it, and guide the user. We do not claim continuous tracking.
- Boot recovery: after reboot the app will **not** silently resume tracking. It posts a notification asking the employee to reopen the app if a shift is still open. [proposed, privacy-preserving]

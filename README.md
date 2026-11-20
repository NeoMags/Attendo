# Attendo — Employee Attendance & GPS Field Tracking

Transparent, work-hours-only attendance and location tracking. See `docs/ARCHITECTURE.md`.

## Layout
- `android/` Employee app (Kotlin, Compose) — Phase 3+
- `web/` Admin dashboard (React + Vite) — Phase 6+
- `supabase/` Migrations and Edge Functions — Phase 2+
- `PROJECT_STATUS.md`, `ENVIRONMENT.md`

## Run the web app (works today)
```
cd web
cp .env.example .env   # fill in values
npm install
npm run dev
npm test
npm run build
```

## Phases
1 Architecture · 2 Supabase DB/auth · 3 Android app · 4 GPS service (+ device health reporter) · 5 Offline sync · 6 Dashboard · 7 Live map · 8 Route history, analytics, playback · 9 Reports (incl. productivity) and exports · 10 Security and testing · 11 APK and deployment

Android build and Supabase setup instructions are added as those phases land.

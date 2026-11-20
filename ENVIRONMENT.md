# ENVIRONMENT

Never commit real values. Templates: `web/.env.example`, `android/local.properties.example` (Phase 3).

| Variable | Used by | Secret? | Where it comes from |
|---|---|---|---|
| `VITE_SUPABASE_URL` | web | No | Supabase project settings |
| `VITE_SUPABASE_ANON_KEY` | web | No (public, RLS-protected) | Supabase API settings |
| `VITE_GOOGLE_MAPS_API_KEY` | web | Restrict by HTTP referrer | Google Cloud Console, Maps JavaScript API |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | android (BuildConfig) | No | same as above |
| `MAPS_API_KEY` | android manifest placeholder | Restrict by package + SHA-1 | Google Cloud, Maps SDK for Android |
| `google-services.json` | android | Not committed | Firebase console (FCM) |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions only | **Yes** | Supabase secrets; never in APK or web |
| `FCM_SERVICE_ACCOUNT_JSON` | Edge Functions only | **Yes** | Firebase service account |
| `RELEASE_KEYSTORE_*` | android release build | **Yes** | Local keystore, outside repo |

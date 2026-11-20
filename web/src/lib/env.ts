// Public, client-safe configuration only. Never put the Supabase service-role key here.
export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
  googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined,
}

export function missingEnv(): string[] {
  const missing: string[] = []
  if (!env.supabaseUrl) missing.push('VITE_SUPABASE_URL')
  if (!env.supabaseAnonKey) missing.push('VITE_SUPABASE_ANON_KEY')
  if (!env.googleMapsApiKey) missing.push('VITE_GOOGLE_MAPS_API_KEY')
  return missing
}

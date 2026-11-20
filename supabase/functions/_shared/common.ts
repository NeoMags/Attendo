// Shared helpers for Attendo Edge Functions (Deno). SUPABASE_URL / SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY are injected by the Supabase Edge runtime; never ship the service key to clients.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
export const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
export const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export const adminClient = (): SupabaseClient =>
  createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

export const anonClient = (): SupabaseClient =>
  createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

// Bearer-token API (no cookies), so a wildcard origin does not widen exposure; auth is enforced per request.
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

/** Answer browser CORS preflight; returns null for any other method. */
export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response(null, { status: 204, headers: CORS }) : null
}

export const CODE_RE = /^[A-Za-z0-9._-]{1,32}$/
export const COMPANY_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/

export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string') return 'password is required'
  if (pw.length < 8 || pw.length > 72) return 'password must be 8-72 characters'
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'password must contain letters and digits'
  return null
}

export interface Caller { userId: string; role: 'super_admin' | 'company_admin' | 'manager' | 'employee'; companyId: string | null }

/** Authenticate the bearer token and load the caller's role from user_roles (never from client claims). */
export async function requireCaller(req: Request, admin: SupabaseClient): Promise<Caller | Response> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'UNAUTHENTICATED' }, 401)
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return json({ error: 'UNAUTHENTICATED' }, 401)
  const { data: r } = await admin.from('user_roles').select('role, company_id').eq('user_id', data.user.id).maybeSingle()
  if (!r) return json({ error: 'FORBIDDEN' }, 403)
  return { userId: data.user.id, role: r.role, companyId: r.company_id }
}

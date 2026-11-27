// POST { company_code, employee_code, password } -> Supabase session.
// The Employee ID is mapped server-side to an internal phone identifier; the mapping is never exposed.
// Errors are uniform (no user enumeration) and failed attempts are throttled.
import { adminClient, anonClient, json, CODE_RE, COMPANY_RE } from '../_shared/common.ts'

const MAX_FAILURES = 5          // per identifier per window
const MAX_IP_FAILURES = 30      // per IP per window
const WINDOW_MIN = 15

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'INVALID_REQUEST' }, 400) }
  const company = String(body.company_code ?? '').trim().toLowerCase()
  const code = String(body.employee_code ?? '').trim()
  const password = typeof body.password === 'string' ? body.password : ''
  if (!COMPANY_RE.test(company) || !CODE_RE.test(code) || password.length < 1 || password.length > 128) {
    return json({ error: 'INVALID_CREDENTIALS' }, 401)
  }
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null
  const identifier = `${company}:${code.toLowerCase()}`
  const admin = adminClient()
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString()

  const { count: idFails } = await admin.from('login_attempts').select('id', { count: 'exact', head: true })
    .eq('identifier', identifier).eq('succeeded', false).gte('attempted_at', since)
  let ipFails = 0
  if (ip) {
    const r = await admin.from('login_attempts').select('id', { count: 'exact', head: true })
      .eq('ip', ip).eq('succeeded', false).gte('attempted_at', since)
    ipFails = r.count ?? 0
  }
  if ((idFails ?? 0) >= MAX_FAILURES || ipFails >= MAX_IP_FAILURES) {
    return json({ error: 'TOO_MANY_ATTEMPTS', retry_after_minutes: WINDOW_MIN }, 429)
  }

  const { data: phone } = await admin.rpc('resolve_employee_login', { p_company_code: company, p_employee_code: code })
  let session = null
  if (typeof phone === 'string') {
    const { data, error } = await anonClient().auth.signInWithPassword({ phone, password })
    if (!error && data.session) session = data.session
  }
  await admin.from('login_attempts').insert({ identifier, ip, succeeded: session !== null })
  if (!session) return json({ error: 'INVALID_CREDENTIALS' }, 401)
  // Employee app is blocked once the company's plan is past its grace window (after the password was verified, so no enumeration).
  const { data: emp } = await admin.from('employees').select('company_id').eq('user_id', session.user.id).maybeSingle()
  if (emp?.company_id) {
    const { data: state } = await admin.rpc('subscription_state_for', { p_company: emp.company_id })
    if (state === 'expired') return json({ error: 'SUBSCRIPTION_EXPIRED' }, 402)
  }
  return json({
    access_token: session.access_token, refresh_token: session.refresh_token,
    expires_in: session.expires_in, token_type: session.token_type,
    must_change_password: session.user.user_metadata?.must_change_password === true,
  })
})

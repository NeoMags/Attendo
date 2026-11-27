// POST (Authorization: Bearer <admin JWT>) -> creates auth user + employees row + user_roles row atomically
// (best effort rollback). company_admin creates in their own company; super_admin must pass company_id.
import { adminClient, json, preflight, requireCaller, passwordProblem, CODE_RE } from '../_shared/common.ts'

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  const admin = adminClient()
  const caller = await requireCaller(req, admin)
  if (caller instanceof Response) return caller
  if (caller.role !== 'company_admin' && caller.role !== 'super_admin') return json({ error: 'FORBIDDEN' }, 403)

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return json({ error: 'INVALID_REQUEST' }, 400) }
  const companyId = caller.role === 'super_admin' ? String(b.company_id ?? '') : caller.companyId
  const code = String(b.employee_code ?? '').trim()
  const name = String(b.full_name ?? '').trim()
  const role = b.role === 'manager' ? 'manager' : 'employee'
  const pwProblem = passwordProblem(b.password)
  if (!companyId) return json({ error: 'COMPANY_REQUIRED' }, 400)
  if (caller.role !== 'super_admin') {
    const { data: state } = await admin.rpc('subscription_state_for', { p_company: companyId })
    if (state !== 'active') return json({ error: 'SUBSCRIPTION_EXPIRED' }, 403)
  }
  if (!CODE_RE.test(code)) return json({ error: 'INVALID_EMPLOYEE_CODE' }, 400)
  if (name.length < 1 || name.length > 200) return json({ error: 'INVALID_NAME' }, 400)
  if (pwProblem) return json({ error: 'WEAK_PASSWORD', message: pwProblem }, 400)

  const { data: emp, error: eErr } = await admin.from('employees').insert({
    company_id: companyId, employee_code: code, full_name: name,
    department_id: b.department_id ?? null, shift_id: b.shift_id ?? null,
    contact_phone: b.contact_phone ?? null, contact_email: b.contact_email ?? null,
    preferred_language: b.preferred_language ?? 'en', joined_on: b.joined_on ?? null,
  }).select('id, login_phone').single()
  if (eErr?.message?.includes('EMPLOYEE_LIMIT_REACHED')) return json({ error: 'EMPLOYEE_LIMIT_REACHED' }, 409)
  if (eErr || !emp) return json({ error: 'EMPLOYEE_CREATE_FAILED', message: eErr?.message }, eErr?.code === '23505' ? 409 : 400)

  const { data: u, error: uErr } = await admin.auth.admin.createUser({
    phone: emp.login_phone, password: String(b.password), phone_confirm: true,
    user_metadata: { must_change_password: true },
  })
  if (uErr || !u.user) {
    await admin.from('employees').delete().eq('id', emp.id)
    return json({ error: 'AUTH_USER_CREATE_FAILED', message: uErr?.message }, 400)
  }
  const { error: lErr } = await admin.from('employees').update({ user_id: u.user.id }).eq('id', emp.id)
  const { error: rErr } = lErr ? { error: lErr } : await admin.from('user_roles').insert({ user_id: u.user.id, company_id: companyId, role })
  if (lErr || rErr) {
    await admin.auth.admin.deleteUser(u.user.id)
    await admin.from('employees').delete().eq('id', emp.id)
    return json({ error: 'ROLE_ASSIGN_FAILED', message: (lErr ?? rErr)?.message }, 500)
  }
  return json({ employee_id: emp.id, user_id: u.user.id, employee_code: code, role }, 201)
})

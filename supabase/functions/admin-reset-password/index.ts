// POST { employee_id, new_password } (admin JWT). Employees have no reachable phone/email for self-service
// reset (internal identifier), so reset is admin-mediated. Forces a password change at next login.
import { adminClient, json, preflight, requireCaller, passwordProblem } from '../_shared/common.ts'

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  const admin = adminClient()
  const caller = await requireCaller(req, admin)
  if (caller instanceof Response) return caller
  if (caller.role !== 'company_admin' && caller.role !== 'super_admin') return json({ error: 'FORBIDDEN' }, 403)
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return json({ error: 'INVALID_REQUEST' }, 400) }
  const problem = passwordProblem(b.new_password)
  if (problem) return json({ error: 'WEAK_PASSWORD', message: problem }, 400)
  const { data: emp } = await admin.from('employees').select('id, company_id, user_id').eq('id', String(b.employee_id ?? '')).maybeSingle()
  if (!emp || !emp.user_id) return json({ error: 'NOT_FOUND' }, 404)
  if (caller.role !== 'super_admin' && emp.company_id !== caller.companyId) return json({ error: 'NOT_FOUND' }, 404)
  if (caller.role !== 'super_admin') {
    const { data: state } = await admin.rpc('subscription_state_for', { p_company: emp.company_id })
    if (state !== 'active') return json({ error: 'SUBSCRIPTION_EXPIRED' }, 403)
  }
  const { error } = await admin.auth.admin.updateUserById(emp.user_id, {
    password: String(b.new_password), user_metadata: { must_change_password: true },
  })
  if (error) return json({ error: 'RESET_FAILED', message: error.message }, 400)
  await admin.from('audit_logs').insert({ company_id: emp.company_id, actor_user_id: caller.userId, action: 'RESET_PASSWORD',
    entity_type: 'employees', entity_id: emp.id, details: {} })
  return json({ ok: true })
})

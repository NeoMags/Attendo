// POST (super_admin JWT) { action:'list', company_id } -> company admins; { action:'reset', company_id, user_id } ->
// new temporary password (shown once) and must_change_password. Lets the platform owner recover a customer who lost their login.
import { adminClient, json, preflight, requireCaller } from '../_shared/common.ts'
import { generateTempPassword } from '../_shared/temp-password.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  const admin = adminClient()
  const caller = await requireCaller(req, admin)
  if (caller instanceof Response) return caller
  if (caller.role !== 'super_admin') return json({ error: 'FORBIDDEN' }, 403)
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return json({ error: 'INVALID_REQUEST' }, 400) }
  const companyId = String(b.company_id ?? '')
  if (!UUID_RE.test(companyId)) return json({ error: 'INVALID_REQUEST' }, 400)

  const { data: roles } = await admin.from('user_roles').select('user_id').eq('company_id', companyId).eq('role', 'company_admin')
  const ids = (roles ?? []).map((r: { user_id: string }) => r.user_id)

  if (b.action === 'list') {
    const admins = []
    for (const id of ids) {
      const { data } = await admin.auth.admin.getUserById(id)
      if (data?.user) admins.push({ user_id: id, email: data.user.email ?? null })
    }
    return json({ admins })
  }
  if (b.action !== 'reset') return json({ error: 'INVALID_REQUEST' }, 400)
  const userId = String(b.user_id ?? '')
  if (!ids.includes(userId)) return json({ error: 'NOT_FOUND' }, 404)
  const password = generateTempPassword()
  const { data, error } = await admin.auth.admin.updateUserById(userId, { password, user_metadata: { must_change_password: true } })
  if (error || !data.user) return json({ error: 'RESET_FAILED', message: error?.message }, 400)
  await admin.from('audit_logs').insert({ company_id: companyId, actor_user_id: caller.userId, action: 'ADMIN_LOGIN_RESET',
    entity_type: 'user_roles', entity_id: userId, details: {} })
  return json({ email: data.user.email, temporary_password: password })
})

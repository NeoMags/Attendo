// POST { id } -> sends the push for one notification row (data-only FCM v1 message) to the employee's devices.
// Called by a database trigger (pg_net). verify_jwt is off; safety comes from the server-side claim below:
// only a notification with delivered_at IS NULL can be sent, and it is claimed atomically, so a replay or a
// forged call can never send anything twice or send anything that was not already queued by the database.
import { adminClient, json, preflight } from '../_shared/common.ts'

const SA = (() => { try { return JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT_JSON') ?? '') } catch { return null } })()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const b64url = (b: ArrayBuffer | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b)
  let s = ''; bytes.forEach((x) => (s += String.fromCharCode(x)))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

let cached: { token: string; exp: number } | null = null
async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cached && cached.exp - 60 > now) return cached.token
  const pem = String(SA.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(JSON.stringify({ iss: SA.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`))
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64url(sig)}` }),
  })
  const j = await r.json()
  if (!r.ok || !j.access_token) throw new Error('FCM_AUTH_FAILED')
  cached = { token: j.access_token, exp: now + Number(j.expires_in ?? 3600) }
  return cached.token
}

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  if (!SA?.private_key || !SA?.client_email || !SA?.project_id) return json({ error: 'PUSH_NOT_CONFIGURED' }, 503)
  let id = ''
  try { id = String((await req.json()).id ?? '') } catch { return json({ error: 'INVALID_REQUEST' }, 400) }
  if (!UUID_RE.test(id)) return json({ error: 'INVALID_REQUEST' }, 400)

  const admin = adminClient()
  const { data: n } = await admin.from('notifications').select('id, employee_id, title, body, kind, delivered_at').eq('id', id).maybeSingle()
  if (!n || !n.employee_id || n.delivered_at) return json({ sent: 0 })
  const { data: devs } = await admin.from('employee_devices').select('id, fcm_token').eq('employee_id', n.employee_id).not('fcm_token', 'is', null)
  if (!devs?.length) return json({ sent: 0, reason: 'NO_DEVICES' })   // left undelivered; nothing to claim
  const { data: claimed } = await admin.from('notifications').update({ delivered_at: new Date().toISOString() })
    .eq('id', id).is('delivered_at', null).select('id')
  if (!claimed?.length) return json({ sent: 0 })

  let sent = 0
  try {
    const at = await accessToken()
    for (const d of devs) {
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${SA.project_id}/messages:send`, {
        method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token: d.fcm_token, android: { priority: 'HIGH' }, data: { title: String(n.title), body: String(n.body ?? ''), kind: String(n.kind) } } }),
      })
      if (r.ok) { sent++; continue }
      const e = await r.json().catch(() => ({}))
      const status = e?.error?.status
      if (status === 'UNREGISTERED' || status === 'NOT_FOUND' || status === 'INVALID_ARGUMENT') {
        await admin.from('employee_devices').update({ fcm_token: null }).eq('id', d.id)   // dead token
      }
    }
  } catch (_) {
    await admin.from('notifications').update({ delivered_at: null }).eq('id', id)   // allow a retry
    return json({ error: 'FCM_FAILED' }, 502)
  }
  return json({ sent })
})

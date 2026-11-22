import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { unreadCount, type Notif } from '@/lib/notify'
import { Icon } from '@/components/ui'

export default function NotificationBell() {
  const { session, companyId } = useAuth()
  const uid = session?.user.id
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [live, setLive] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  const list = useQuery({
    queryKey: ['notifs', companyId], enabled: !!companyId, refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('notifications').select('id, kind, title, body, created_at, data')
        .eq('company_id', companyId!).is('employee_id', null).order('created_at', { ascending: false }).limit(30)
      if (error) throw error
      return (data ?? []) as Notif[]
    },
  })
  const prefs = useQuery({
    queryKey: ['prefs', uid], enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from('user_prefs').select('notif_seen_at, dashboard_cards').maybeSingle()
      if (error) throw error
      return data as { notif_seen_at: string | null; dashboard_cards: unknown } | null
    },
  })

  // Live: a new admin notification (e.g. an employee left a geofence) appears instantly.
  useEffect(() => {
    if (!companyId) return
    const ch = supabase.channel(`notifs-${companyId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `company_id=eq.${companyId}` }, (p) => {
        const n = p.new as Notif & { employee_id: string | null }
        if (n.employee_id !== null) return
        void qc.invalidateQueries({ queryKey: ['notifs', companyId] })
        setLive(n.title)
        setTimeout(() => setLive(null), 8000)
      })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [companyId, qc])

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const items = list.data ?? []
  const unread = unreadCount(items, prefs.data?.notif_seen_at)

  async function markSeen() {
    if (!uid) return
    await supabase.from('user_prefs').upsert({ user_id: uid, notif_seen_at: new Date().toISOString() }, { onConflict: 'user_id' })
    await qc.invalidateQueries({ queryKey: ['prefs', uid] })
  }

  return (
    <div className="relative" ref={box}>
      <button type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => setOpen((o) => !o)}
        className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100">
        <Icon name="bell" className="h-5 w-5" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-[18px] text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {live && <div role="status" className="absolute right-0 top-11 z-30 w-72 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 shadow-lg">{live}</div>}
      {open && (
        <div className="absolute right-0 top-11 z-40 w-80 rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            <button type="button" className="text-xs text-slate-600 underline disabled:opacity-40" disabled={!unread} onClick={() => void markSeen()}>Mark all read</button>
          </div>
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No notifications yet.</li>}
            {items.map((n) => {
              const isNew = unreadCount([n], prefs.data?.notif_seen_at) > 0
              return (
                <li key={n.id} className={`px-3 py-2 text-sm ${isNew ? 'bg-amber-50' : ''}`}>
                  <div className="font-medium text-slate-900">{n.title}</div>
                  {n.body && <div className="text-xs text-slate-600">{n.body}</div>}
                  <div className="text-[11px] text-slate-400">{new Date(n.created_at).toLocaleString()}</div>
                </li>
              )
            })}
          </ul>
          <Link to="/alerts" onClick={() => setOpen(false)} className="block border-t border-slate-100 px-3 py-2 text-center text-xs text-slate-600 hover:bg-slate-50">All geofence alerts</Link>
        </div>
      )}
    </div>
  )
}

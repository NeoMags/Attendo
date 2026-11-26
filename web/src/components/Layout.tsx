import { Suspense } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { navFor, canUseDashboard, NAV_GROUPS } from '@/lib/roles'
import { Button, Select, Skeleton } from '@/components/ui'
import Clock from '@/components/Clock'
import NotificationBell from '@/components/NotificationBell'

export default function Layout() {
  const { role, session, signOut, companies, companyId, setCompanyId, company } = useAuth()

  if (!canUseDashboard(role)) {
    return (
      <main className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">No dashboard access</h1>
        <p className="mt-2 text-sm text-slate-600">This account is not an administrator or manager. Employees use the Attendo mobile app.</p>
        <Button variant="ghost" className="mt-4" onClick={signOut}>Sign out</Button>
      </main>
    )
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white p-4 md:block">
        <div className="mb-6 flex items-center gap-2 text-lg font-semibold">
          <span aria-hidden className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-amber-400 text-sm font-bold text-slate-900">A</span>
          Attendo
        </div>
        <nav className="space-y-4">
          {NAV_GROUPS.map((g) => {
            const items = navFor(role).filter((n) => n.group === g)
            if (!items.length) return null
            return (
              <div key={g}>
                <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g}</div>
                <div className="space-y-0.5">
                  {items.map((n) => (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.to === '/'}
                      className={({ isActive }) => `block rounded-md border-l-[3px] px-3 py-2 text-sm ${isActive ? 'border-amber-400 bg-amber-50 font-medium text-slate-900' : 'border-transparent text-slate-700 hover:bg-slate-100'}`}
                    >
                      {n.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            )
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2">
          <div className="flex items-center gap-2">
            {role === 'super_admin' ? (
              <Select aria-label="Company" value={companyId ?? ''} onChange={(e) => setCompanyId(e.target.value || null)} className="w-56">
                {companies.length === 0 && <option value="">No companies yet</option>}
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_active ? '' : ' (inactive)'}</option>)}
              </Select>
            ) : (
              <span className="text-sm font-medium">{companies[0]?.name}</span>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <Clock timeZone={company?.timezone} />
            <NotificationBell />
            <span className="hidden lg:inline">{session?.user.email} · {role?.replace('_', ' ')}</span>
            <Button variant="ghost" onClick={signOut}>Sign out</Button>
          </div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white p-2 md:hidden">
          {navFor(role).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-amber-100 font-medium text-slate-900' : 'text-slate-700'}`}>{n.label}</NavLink>
          ))}
        </nav>
        <main className="min-w-0 flex-1 p-4 md:p-6"><Suspense fallback={<Skeleton />}><Outlet /></Suspense></main>
      </div>
    </div>
  )
}

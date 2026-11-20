import { Suspense } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { navFor, canUseDashboard } from '@/lib/roles'
import { Button, Select, Spinner } from '@/components/ui'

export default function Layout() {
  const { role, session, signOut, companies, companyId, setCompanyId } = useAuth()

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
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white p-4 md:block">
        <div className="mb-6 text-lg font-semibold">Attendo</div>
        <nav className="space-y-1">
          {navFor(role).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => `block rounded-md px-3 py-2 text-sm ${isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              {n.label}
            </NavLink>
          ))}
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
            <span className="hidden sm:inline">{session?.user.email} · {role?.replace('_', ' ')}</span>
            <Button variant="ghost" onClick={signOut}>Sign out</Button>
          </div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white p-2 md:hidden">
          {navFor(role).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-slate-900 text-white' : 'text-slate-700'}`}>{n.label}</NavLink>
          ))}
        </nav>
        <main className="min-w-0 flex-1 p-4 md:p-6"><Suspense fallback={<Spinner />}><Outlet /></Suspense></main>
      </div>
    </div>
  )
}

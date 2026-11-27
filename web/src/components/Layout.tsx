import { Suspense, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { navFor, canUseDashboard, NAV_GROUPS, type Role } from '@/lib/roles'
import { Avatar, Button, Select, Skeleton, Icon } from '@/components/ui'
import Clock from '@/components/Clock'
import NotificationBell from '@/components/NotificationBell'

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 32 32">
      <rect width="32" height="32" rx="9" fill="var(--color-primary-600)" />
      <path d="M8 22 16 9l8 13" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="22" r="2.6" fill="#fff" />
      <circle cx="24" cy="22" r="2.6" fill="#fff" />
      <circle cx="16" cy="9" r="2.6" fill="var(--color-signal)" stroke="#fff" strokeWidth="1.6" />
    </svg>
  )
}

function SidebarContent({ role, onNav }: { role: string | null; onNav?: () => void }) {
  const all = navFor((role as Role | undefined) ?? undefined)
  return (
    <>
      <div className="mb-6 flex items-center gap-2.5 px-2.5">
        <BrandMark />
        <span className="text-[19px] font-semibold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
          Attendo
        </span>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto pb-4" aria-label="Main">
        {NAV_GROUPS.map((g) => {
          const items = all.filter((n) => n.group === g)
          if (!items.length) return null
          return (
            <div key={g}>
              <div className="mb-1.5 px-2.5 text-xs font-semibold capitalize" style={{ color: 'var(--color-text-tertiary)' }}>
                {g.toLowerCase()}
              </div>
              <div className="route-nav space-y-0.5">
                {items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={onNav} className="route-stop">
                    {n.label}
                  </NavLink>
                ))}
              </div>
            </div>
          )
        })}
      </nav>
    </>
  )
}

export default function Layout() {
  const { role, session, signOut, companies, companyId, setCompanyId, company } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  if (!canUseDashboard(role)) {
    return (
      <main className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">No dashboard access</h1>
        <p className="mt-2 text-sm text-slate-600">
          This account is not an administrator or manager. Employees use the Attendo mobile app.
        </p>
        <Button variant="ghost" className="mt-4" onClick={signOut}>Sign out</Button>
      </main>
    )
  }

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--color-bg-base)' }}>
      {/* Desktop rail */}
      <aside
        className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col px-3.5 py-5 md:flex"
        style={{ background: 'var(--color-sidebar-bg)', borderRight: '1px solid var(--color-border)' }}
      >
        <SidebarContent role={role} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 animate-fade" style={{ background: 'var(--color-surface-overlay)' }} onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col px-3.5 py-5" style={{ background: 'var(--color-sidebar-bg)' }}>
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 rounded-lg p-1.5 hover:bg-[var(--color-bg-muted)]"
              style={{ color: 'var(--color-text-muted)' }}
              aria-label="Close menu"
            >
              <Icon name="x" size={18} />
            </button>
            <SidebarContent role={role} onNav={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 px-4 md:px-8"
          style={{ background: 'color-mix(in srgb, var(--color-bg-base) 88%, transparent)', backdropFilter: 'blur(10px)', borderBottom: '1px solid var(--color-border)' }}
        >
          <button
            className="-ml-1 rounded-lg p-1.5 hover:bg-[var(--color-bg-muted)] md:hidden"
            style={{ color: 'var(--color-text-secondary)' }}
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Icon name="menu" size={20} />
          </button>

          <div className="flex items-center gap-2">
            {role === 'super_admin' ? (
              <Select
                aria-label="Company"
                value={companyId ?? ''}
                onChange={(e) => setCompanyId(e.target.value || null)}
                className="!h-9 w-48 !text-sm"
              >
                {companies.length === 0 && <option value="">No companies yet</option>}
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.is_active ? '' : ' (inactive)'}
                  </option>
                ))}
              </Select>
            ) : (
              <span className="text-sm font-semibold">{companies[0]?.name}</span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <Clock timeZone={company?.timezone} />
            <NotificationBell />
            <div className="hidden items-center gap-2.5 border-l pl-3 lg:flex" style={{ borderColor: 'var(--color-border)' }}>
              <Avatar name={session?.user.email ?? '?'} size="sm" />
              <div className="leading-tight">
                <div className="max-w-[11rem] truncate text-[13px] font-medium">{session?.user.email}</div>
                <div className="text-xs capitalize" style={{ color: 'var(--color-text-muted)' }}>{role?.replace('_', ' ')}</div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={signOut}>Sign out</Button>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8 animate-page">
          <Suspense fallback={<Skeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}

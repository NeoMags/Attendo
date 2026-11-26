import { Suspense, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { navFor, canUseDashboard, NAV_GROUPS } from '@/lib/roles'
import { Button, Select, Skeleton, Icon } from '@/components/ui'
import Clock from '@/components/Clock'
import NotificationBell from '@/components/NotificationBell'

// Map route paths to icon names (Icon component from ui.tsx)
const NAV_ICONS: Record<string, string> = {
  '/':           'home',
  '/map':        'map-pin',
  '/routes':     'route',
  '/schedule':   'calendar-clock',
  '/alerts':     'bell-ring',
  '/devices':    'smartphone',
  '/analytics':  'bar-chart-2',
  '/employees':  'users',
  '/attendance': 'clock',
  '/tasks':      'check-square',
  '/leave':      'umbrella',
  '/calendar':   'calendar',
  '/payroll':    'banknote',
  '/reports':    'file-text',
  '/team':       'git-branch',
  '/geofences':  'hexagon',
  '/setup':      'settings-2',
  '/companies':  'building-2',
}

// Map route paths to human-readable page titles (for breadcrumb / top bar)
const PAGE_TITLES: Record<string, string> = {
  '/':           'Overview',
  '/map':        'Live Map',
  '/routes':     'Route History',
  '/schedule':   'Field Schedule',
  '/alerts':     'Geofence Alerts',
  '/devices':    'Device Health',
  '/analytics':  'Analytics',
  '/employees':  'Employees',
  '/attendance': 'Attendance',
  '/tasks':      'Tasks',
  '/leave':      'Leave Requests',
  '/calendar':   'Attendance Calendar',
  '/payroll':    'Payroll',
  '/reports':    'Reports',
  '/team':       'Manager Teams',
  '/geofences':  'Geofences',
  '/setup':      'Departments & Shifts',
  '/companies':  'Companies',
}

function SidebarContent({ role, onNav }: { role: string | null; onNav?: () => void }) {
  return (
    <>
      {/* Logo / Brand */}
      <div className="mb-7 flex items-center gap-3 px-2">
        <span
          aria-hidden
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
          style={{ background: 'var(--color-sidebar-accent)', color: '#0f172a' }}
        >
          A
        </span>
        <span className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--color-sidebar-text-active)' }}>
          Attendo
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-5 overflow-y-auto">
        {NAV_GROUPS.map((g) => {
          const items = navFor(role).filter((n) => n.group === g)
          if (!items.length) return null
          return (
            <div key={g}>
              <div
                className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: 'var(--color-sidebar-text)', opacity: 0.5 }}
              >
                {g}
              </div>
              <div className="space-y-0.5">
                {items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.to === '/'}
                    onClick={onNav}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-lg border-l-[3px] px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'border-[var(--color-sidebar-accent)] font-semibold'
                          : 'border-transparent'
                      }`
                    }
                    style={({ isActive }) => ({
                      background: isActive ? 'var(--color-sidebar-active-bg)' : undefined,
                      color: isActive ? 'var(--color-sidebar-text-active)' : 'var(--color-sidebar-text)',
                    })}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget
                      if (!el.dataset.active) el.style.background = 'var(--color-sidebar-hover-bg)'
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget
                      if (!el.dataset.active) el.style.background = ''
                    }}
                  >
                    {({ isActive }) => (
                      <>
                        <Icon
                          name={NAV_ICONS[n.to] ?? 'circle'}
                          size={16}
                          style={{ color: isActive ? 'var(--color-sidebar-accent)' : 'var(--color-sidebar-text)', opacity: isActive ? 1 : 0.7 }}
                        />
                        {n.label}
                      </>
                    )}
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
  const location = useLocation()
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

  // Resolve page title for top bar
  const pageTitle = PAGE_TITLES[location.pathname] ?? ''

  return (
    <div className="flex min-h-screen text-slate-900" style={{ background: 'var(--color-bg-base)' }}>

      {/* ── Desktop sidebar ───────────────────────────────── */}
      <aside
        className="hidden w-60 shrink-0 flex-col p-4 md:flex"
        style={{
          background: 'var(--color-sidebar-bg)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <SidebarContent role={role} />
      </aside>

      {/* ── Mobile drawer overlay ─────────────────────────── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          {/* Drawer */}
          <aside
            className="absolute inset-y-0 left-0 flex w-64 flex-col p-4"
            style={{ background: 'var(--color-sidebar-bg)' }}
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-semibold" style={{ color: 'var(--color-sidebar-text-active)' }}>
                Menu
              </span>
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded p-1 text-slate-400 hover:text-white"
                aria-label="Close menu"
              >
                <Icon name="x" size={18} />
              </button>
            </div>
            <SidebarContent role={role} onNav={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* ── Main content area ─────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">

        {/* Top bar */}
        <header
          className="flex shrink-0 items-center gap-4 border-b px-4 py-0"
          style={{
            background: 'var(--color-bg-surface)',
            borderColor: 'var(--color-border)',
            height: '52px',
          }}
        >
          {/* Mobile hamburger */}
          <button
            className="md:hidden -ml-1 rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Icon name="menu" size={20} />
          </button>

          {/* Page title — desktop only */}
          {pageTitle && (
            <span className="hidden text-sm font-semibold text-slate-900 md:inline">{pageTitle}</span>
          )}

          {/* Company selector / name */}
          <div className="flex items-center gap-2 md:ml-0">
            {role === 'super_admin' ? (
              <Select
                aria-label="Company"
                value={companyId ?? ''}
                onChange={(e) => setCompanyId(e.target.value || null)}
                className="w-48"
              >
                {companies.length === 0 && <option value="">No companies yet</option>}
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.is_active ? '' : ' (inactive)'}
                  </option>
                ))}
              </Select>
            ) : (
              <span className="text-sm font-medium text-slate-700">{companies[0]?.name}</span>
            )}
          </div>

          {/* Right side */}
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-600">
            <Clock timeZone={company?.timezone} />
            <NotificationBell />
            <span className="hidden lg:inline text-slate-500">
              {session?.user.email}
              <span className="mx-1.5 text-slate-300">·</span>
              <span className="capitalize">{role?.replace('_', ' ')}</span>
            </span>
            <Button variant="ghost" onClick={signOut}>Sign out</Button>
          </div>
        </header>

        {/* Page content */}
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <Suspense fallback={<Skeleton />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}

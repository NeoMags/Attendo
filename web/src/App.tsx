import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '@/lib/auth'
import { isAdmin, type Role } from '@/lib/roles'
import { missingEnv } from '@/lib/env'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
import ForcePasswordChange from '@/components/ForcePasswordChange'
const loadOverview = () => import('@/pages/Overview')
const Overview = lazy(loadOverview)
const loadEmployees = () => import('@/pages/Employees')
const Employees = lazy(loadEmployees)
const loadAttendance = () => import('@/pages/Attendance')
const Attendance = lazy(loadAttendance)
const loadLiveMap = () => import('@/pages/LiveMap')
const LiveMap = lazy(loadLiveMap)
const loadFieldSchedule = () => import('@/pages/FieldSchedule')
const FieldSchedule = lazy(loadFieldSchedule)
const loadRoutes_ = () => import('@/pages/Routes')
const Routes_ = lazy(loadRoutes_)
const loadAnalytics = () => import('@/pages/Analytics')
const Analytics = lazy(loadAnalytics)
const loadReports = () => import('@/pages/Reports')
const Reports = lazy(loadReports)
const loadAttendanceCalendar = () => import('@/pages/AttendanceCalendar')
const AttendanceCalendar = lazy(loadAttendanceCalendar)
const loadLeave = () => import('@/pages/Leave')
const Leave = lazy(loadLeave)
const loadTasks = () => import('@/pages/Tasks')
const Tasks = lazy(loadTasks)
const loadPayroll = () => import('@/pages/Payroll')
const Payroll = lazy(loadPayroll)
const loadAlerts = () => import('@/pages/Alerts')
const Alerts = lazy(loadAlerts)
const loadDevices = () => import('@/pages/Devices')
const Devices = lazy(loadDevices)
const loadGeofences = () => import('@/pages/Geofences')
const Geofences = lazy(loadGeofences)
const loadTeam = () => import('@/pages/Team')
const Team = lazy(loadTeam)
const loadSetup = () => import('@/pages/Setup')
const Setup = lazy(loadSetup)
const loadCompanies = () => import('@/pages/Companies')
const Companies = lazy(loadCompanies)
const SubscriptionRequests = lazy(() => import('@/pages/SubscriptionRequests'))
const PlatformSettings = lazy(() => import('@/pages/PlatformSettings'))
const Billing = lazy(() => import('@/pages/Billing'))
const Plans = lazy(() => import('@/pages/public/Plans'))
const Subscribe = lazy(() => import('@/pages/public/Subscribe'))

/** Download every page chunk once the user is signed in and the browser is idle, so navigation feels instant. */
const prefetchPages = () => {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } }
  if (nav.connection?.saveData) return
  const run = () => { [loadOverview, loadEmployees, loadAttendance, loadLiveMap, loadFieldSchedule, loadRoutes_, loadAnalytics, loadReports, loadAttendanceCalendar, loadLeave, loadTasks, loadPayroll, loadAlerts, loadDevices, loadGeofences, loadTeam, loadSetup, loadCompanies].forEach((f) => { f().catch(() => {}) }) }
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 }); else setTimeout(run, 1500)
}
// The landing page starts downloading right away, in parallel with the sign-in check (instead of after it).
if (location.pathname === '/') loadOverview().catch(() => {})

import { Skeleton } from '@/components/ui'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } })

function Protected() {
  const { session, loading } = useAuth()
  useEffect(() => { if (session) prefetchPages() }, [session])
  if (loading) return <Skeleton />
  if (!session) return <Navigate to="/login" replace />
  if (session.user.user_metadata?.must_change_password === true) return <ForcePasswordChange />
  return <Layout />
}

function RoleGate({ allow, children }: { allow: (r: Role | undefined) => boolean; children: React.ReactNode }) {
  const { role } = useAuth()
  return allow(role) ? <>{children}</> : <Navigate to="/" replace />
}

export default function App() {
  // Maps key is only needed from Phase 7 (live map); Supabase settings are required now.
  const missing = missingEnv().filter((m) => m !== 'VITE_GOOGLE_MAPS_API_KEY')
  if (missing.length) {
    return <main className="p-8"><h1 className="text-lg font-semibold">Configuration missing</h1><p className="mt-2 font-mono text-sm">{missing.join(', ')}</p></main>
  }
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/plans" element={<Suspense fallback={<Skeleton />}><Plans /></Suspense>} />
            <Route path="/subscribe" element={<Suspense fallback={<Skeleton />}><Subscribe /></Suspense>} />
            <Route element={<Protected />}>
              <Route index element={<Overview />} />
              <Route path="map" element={<LiveMap />} />
              <Route path="routes" element={<Routes_ />} />
              <Route path="employees" element={<Employees />} />
              <Route path="attendance" element={<Attendance />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="reports" element={<Reports />} />
              <Route path="calendar" element={<AttendanceCalendar />} />
              <Route path="leave" element={<Leave />} />
              <Route path="tasks" element={<Tasks />} />
              <Route path="payroll" element={<RoleGate allow={isAdmin}><Payroll /></RoleGate>} />
              <Route path="schedule" element={<FieldSchedule />} />
              <Route path="alerts" element={<Alerts />} />
              <Route path="devices" element={<Devices />} />
              <Route path="geofences" element={<Geofences />} />
              <Route path="team" element={<RoleGate allow={isAdmin}><Team /></RoleGate>} />
              <Route path="setup" element={<RoleGate allow={isAdmin}><Setup /></RoleGate>} />
              <Route path="billing" element={<RoleGate allow={(r) => r === 'company_admin'}><Billing /></RoleGate>} />
              <Route path="subscriptions" element={<RoleGate allow={(r) => r === 'super_admin'}><SubscriptionRequests /></RoleGate>} />
              <Route path="settings" element={<RoleGate allow={(r) => r === 'super_admin'}><PlatformSettings /></RoleGate>} />
              <Route path="companies" element={<RoleGate allow={(r) => r === 'super_admin'}><Companies /></RoleGate>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

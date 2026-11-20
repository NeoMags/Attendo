import { lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '@/lib/auth'
import { isAdmin, type Role } from '@/lib/roles'
import { missingEnv } from '@/lib/env'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
const Overview = lazy(() => import('@/pages/Overview'))
const Employees = lazy(() => import('@/pages/Employees'))
const Attendance = lazy(() => import('@/pages/Attendance'))
const LiveMap = lazy(() => import('@/pages/LiveMap'))
const Routes_ = lazy(() => import('@/pages/Routes'))
const Analytics = lazy(() => import('@/pages/Analytics'))
const Reports = lazy(() => import('@/pages/Reports'))
const Devices = lazy(() => import('@/pages/Devices'))
const Geofences = lazy(() => import('@/pages/Geofences'))
const Team = lazy(() => import('@/pages/Team'))
const Setup = lazy(() => import('@/pages/Setup'))
const Companies = lazy(() => import('@/pages/Companies'))
import { Spinner } from '@/components/ui'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } })

function Protected() {
  const { session, loading } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
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
            <Route element={<Protected />}>
              <Route index element={<Overview />} />
              <Route path="map" element={<LiveMap />} />
              <Route path="routes" element={<Routes_ />} />
              <Route path="employees" element={<Employees />} />
              <Route path="attendance" element={<Attendance />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="reports" element={<Reports />} />
              <Route path="devices" element={<Devices />} />
              <Route path="geofences" element={<Geofences />} />
              <Route path="team" element={<RoleGate allow={isAdmin}><Team /></RoleGate>} />
              <Route path="setup" element={<RoleGate allow={isAdmin}><Setup /></RoleGate>} />
              <Route path="companies" element={<RoleGate allow={(r) => r === 'super_admin'}><Companies /></RoleGate>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

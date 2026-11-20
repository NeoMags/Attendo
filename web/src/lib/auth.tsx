import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Role } from '@/lib/roles'

export interface Company { id: string; code: string; name: string; timezone: string; is_active: boolean }

interface Ctx {
  session: Session | null
  loading: boolean
  role: Role | undefined
  /** Company the dashboard is scoped to: fixed for company admins/managers, chosen for super admins. */
  companyId: string | null
  company: Company | undefined
  companies: Company[]
  setCompanyId: (id: string | null) => void
  signOut: () => Promise<void>
}

const AuthCtx = createContext<Ctx | null>(null)
const PICK_KEY = 'attendo.company'

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [picked, setPicked] = useState<string | null>(() => {
    try { return localStorage.getItem(PICK_KEY) } catch { return null }
  })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) qc.clear() // never leave one user's cached data around for the next sign-in
    })
    return () => sub.subscription.unsubscribe()
  }, [qc])

  const uid = session?.user.id
  const roleQ = useQuery({
    queryKey: ['my-role', uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from('user_roles').select('role, company_id').eq('user_id', uid!).maybeSingle()
      if (error) throw error
      return data as { role: Role; company_id: string | null } | null
    },
  })
  const role = roleQ.data?.role

  const companiesQ = useQuery({
    queryKey: ['companies', uid],
    enabled: !!role,
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('id, code, name, timezone, is_active').order('name')
      if (error) throw error
      return data as Company[]
    },
  })
  const companies = useMemo(() => companiesQ.data ?? [], [companiesQ.data])

  const companyId = role === 'super_admin'
    ? (companies.find((c) => c.id === picked)?.id ?? companies[0]?.id ?? null)
    : (roleQ.data?.company_id ?? null)

  const value: Ctx = {
    session,
    loading: !ready || (!!uid && roleQ.isLoading),
    role,
    companyId,
    company: companies.find((c) => c.id === companyId),
    companies,
    setCompanyId: (id) => {
      setPicked(id)
      try { id ? localStorage.setItem(PICK_KEY, id) : localStorage.removeItem(PICK_KEY) } catch { /* private mode */ }
    },
    signOut: async () => { await supabase.auth.signOut() },
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth(): Ctx {
  const c = useContext(AuthCtx)
  if (!c) throw new Error('useAuth outside AuthProvider')
  return c
}

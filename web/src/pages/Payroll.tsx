import { lazy, Suspense, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { Skeleton } from '@/components/ui'

const RunTab = lazy(() => import('@/components/payroll/RunTab'))
const AdvancesTab = lazy(() => import('@/components/payroll/AdvancesTab'))
const HolidaysTab = lazy(() => import('@/components/payroll/HolidaysTab'))
const TemplatesTab = lazy(() => import('@/components/payroll/TemplatesTab'))
const StatutoryTab = lazy(() => import('@/components/payroll/StatutoryTab'))
const TaxTab = lazy(() => import('@/components/payroll/TaxTab'))
const EmployeeStatement = lazy(() => import('@/components/payroll/EmployeeStatement'))

const TABS = [['run', 'Monthly payroll'], ['advances', 'Advances'], ['holidays', 'Holidays'], ['statutory', 'PF / ESI'], ['tax', 'Income tax'], ['templates', 'Payslip templates']] as const

export default function Payroll() {
  const { companyId, company } = useAuth()
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('run')
  const [who, setWho] = useState<{ id: string; name: string } | null>(null)
  if (!companyId) return <p className="text-sm text-slate-600">Choose a company first.</p>
  const open = (id: string, name: string) => setWho({ id, name })
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Payroll</h1>
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm ${tab === k ? 'border-b-2 border-slate-900 font-medium' : 'text-slate-500'}`}>{l}</button>)}
      </div>
      <Suspense fallback={<Skeleton />}>
        {tab === 'run' && <RunTab companyId={companyId} companyName={company?.name ?? ''} onOpenEmployee={open} />}
        {tab === 'advances' && <AdvancesTab companyId={companyId} onOpenEmployee={open} />}
        {tab === 'holidays' && <HolidaysTab companyId={companyId} />}
        {tab === 'statutory' && <StatutoryTab companyId={companyId} />}
        {tab === 'tax' && <TaxTab companyId={companyId} />}
        {tab === 'templates' && <TemplatesTab companyId={companyId} />}
        {who && <EmployeeStatement employeeId={who.id} name={who.name} onClose={() => setWho(null)} />}
      </Suspense>
    </div>
  )
}

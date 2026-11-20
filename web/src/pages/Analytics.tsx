import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { todayIn } from '@/lib/format'
import { dailyStats, type AttRow } from '@/lib/analytics'
import { Card, ErrorNote, Field, Input, Spinner, Stat } from '@/components/ui'

const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const PAGE = 1000, MAX_PAGES = 10

export default function Analytics() {
  const { companyId, company } = useAuth()
  const today = todayIn(company?.timezone)
  const [from, setFrom] = useState(() => addDays(today, -29))
  const [to, setTo] = useState(today)
  const bad = from > to || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 92

  const q = useQuery({
    queryKey: ['analytics', companyId, from, to], enabled: !!companyId && !bad,
    queryFn: async () => {
      const rows: AttRow[] = []
      for (let p = 0; p < MAX_PAGES; p++) {
        const { data, error } = await supabase.from('attendance').select('work_date, employee_id, late_minutes, worked_seconds')
          .eq('company_id', companyId!).gte('work_date', from).lte('work_date', to).order('work_date').range(p * PAGE, p * PAGE + PAGE - 1)
        if (error) throw error
        rows.push(...(data as AttRow[]))
        if (data.length < PAGE) break
      }
      return rows
    },
  })
  if (!companyId) return <p className="text-sm text-slate-600">Select a company first.</p>
  const days = q.data ? dailyStats(q.data) : []
  const totalLate = days.reduce((s, d) => s + d.late, 0), totalPresent = days.reduce((s, d) => s + d.present, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-lg font-semibold">Analytics</h1>
        <div className="flex items-end gap-2">
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      </div>
      {bad && <ErrorNote error={new Error('Choose a range of at most 92 days, with the start before the end.')} />}
      {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label="Days with attendance" value={days.length} />
            <Stat label="Employee-days present" value={totalPresent} />
            <Stat label="Late employee-days" value={totalLate} tone={totalLate ? 'warn' : undefined} />
          </div>
          {days.length === 0 ? <p className="text-sm text-slate-600">No attendance in this period.</p> : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Present and late per day">
                <div className="h-64"><ResponsiveContainer><BarChart data={days}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} /><YAxis allowDecimals={false} /><Tooltip /><Legend />
                  <Bar dataKey="present" name="Present" fill="#059669" /><Bar dataKey="late" name="Late" fill="#d97706" /></BarChart></ResponsiveContainer></div>
              </Card>
              <Card title="Average hours worked (closed shifts)">
                <div className="h-64"><ResponsiveContainer><LineChart data={days}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} /><YAxis /><Tooltip />
                  <Line type="monotone" dataKey="avgHours" name="Hours" stroke="#2563eb" dot={false} /></LineChart></ResponsiveContainer></div>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  )
}

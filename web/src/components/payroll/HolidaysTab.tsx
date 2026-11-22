import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Button, Card, ErrorNote, Field, Input, Spinner, Table, Td } from '@/components/ui'

export default function HolidaysTab({ companyId }: { companyId: string }) {
  const qc = useQueryClient()
  const [date, setDate] = useState(''); const [name, setName] = useState(''); const [err, setErr] = useState<string | null>(null)
  const q = useQuery({
    queryKey: ['payroll', 'holidays', companyId],
    queryFn: async () => { const { data, error } = await supabase.from('company_holidays').select('id, holiday_date, name').eq('company_id', companyId).order('holiday_date', { ascending: false }); if (error) throw error; return data as { id: string; holiday_date: string; name: string }[] },
  })
  const add = useMutation({
    mutationFn: async () => {
      if (!date || !name.trim()) throw new Error('Enter a date and a name.')
      const { error } = await supabase.from('company_holidays').insert({ company_id: companyId, holiday_date: date, name: name.trim() })
      if (error) throw new Error(error.code === '23505' ? 'That date is already a holiday.' : error.message)
    },
    onSuccess: () => { setDate(''); setName(''); setErr(null); qc.invalidateQueries({ queryKey: ['payroll'] }) },
    onError: (e: Error) => setErr(e.message),
  })
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('company_holidays').delete().eq('id', id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll'] }),
    onError: (e: Error) => setErr(e.message),
  })
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Holidays on a working day are paid for monthly-salary employees (daily-wage employees are not paid for holidays). Re-run payroll for a draft month after changing holidays.</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e: FormEvent) => { e.preventDefault(); add.mutate() }}>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Name"><Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali" /></Field>
        <Button type="submit" disabled={add.isPending}>Add holiday</Button>
      </form>
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      <Card>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} /> : (
          <Table head={['Date', 'Holiday', '']} empty={q.data?.length ? undefined : 'No holidays added.'}>
            {(q.data ?? []).map((h) => <tr key={h.id}><Td>{h.holiday_date}</Td><Td>{h.name}</Td><Td className="text-right"><Button variant="ghost" onClick={() => { if (window.confirm(`Remove ${h.name}?`)) del.mutate(h.id) }}>Remove</Button></Td></tr>)}
          </Table>
        )}
      </Card>
    </div>
  )
}

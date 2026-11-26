import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isAdmin } from '@/lib/roles'
import { GEOFENCE_TYPES, validateGeofence } from '@/lib/geofence'
import { Badge, Button, Card, ErrorNote, Field, Input, Select, Skeleton, Table, Td } from '@/components/ui'

interface Fence { id: string; name: string; type: string; latitude: number; longitude: number; radius_m: number; hysteresis_fixes: number; is_active: boolean; alert_on_exit: boolean }

export default function Geofences() {
  const { companyId, role } = useAuth()
  const admin = isAdmin(role)
  const qc = useQueryClient()
  const [f, setF] = useState({ name: '', type: 'office', latitude: '', longitude: '', radius_m: '100', hysteresis_fixes: '2' })
  const [formErr, setFormErr] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['geofences', companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('geofences').select('id, name, type, latitude, longitude, radius_m, hysteresis_fixes, is_active, alert_on_exit').eq('company_id', companyId!).order('name')
      if (error) throw error
      return data as Fence[]
    },
  })
  const add = useMutation({
    mutationFn: async () => {
      const v = validateGeofence(f)
      if (!v.ok) throw new Error(v.error)
      const { error } = await supabase.from('geofences').insert({ company_id: companyId!, ...v.value })
      if (error) throw new Error(error.code === '23505' ? 'A geofence with this name already exists.' : error.message)
    },
    onSuccess: () => { setF({ ...f, name: '', latitude: '', longitude: '' }); setFormErr(null); qc.invalidateQueries({ queryKey: ['geofences', companyId] }) },
    onError: (e) => setFormErr(e.message),
  })
  const toggle = useMutation({
    mutationFn: async (g: Fence) => { const { error } = await supabase.from('geofences').update({ is_active: !g.is_active }).eq('id', g.id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['geofences', companyId] }),
  })

  const alertToggle = useMutation({
    mutationFn: async (g: Fence) => { const { error } = await supabase.from('geofences').update({ alert_on_exit: !g.alert_on_exit }).eq('id', g.id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['geofences', companyId] }),
  })

  if (!companyId) return <p className="text-sm text-slate-600">Select a company first.</p>
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card title="Geofences">
          {q.isLoading ? <Skeleton /> : q.error ? <ErrorNote error={q.error} /> : (
            <Table head={['Name', 'Type', 'Centre', 'Radius', 'Status', 'Exit alert', '']} empty={q.data?.length ? undefined : 'No geofences yet.'}>
              {q.data?.map((g) => (
                <tr key={g.id}>
                  <Td>{g.name}</Td><Td>{g.type.replace('_', ' ')}</Td>
                  <Td className="font-mono text-xs">{g.latitude.toFixed(5)}, {g.longitude.toFixed(5)}</Td>
                  <Td>{g.radius_m} m</Td>
                  <Td><Badge tone={g.is_active ? 'good' : 'muted'}>{g.is_active ? 'Active' : 'Off'}</Badge></Td>
                  <Td>{admin ? <Button variant="ghost" disabled={alertToggle.isPending} onClick={() => alertToggle.mutate(g)}>{g.alert_on_exit ? 'On' : 'Off'}</Button> : (g.alert_on_exit ? 'On' : 'Off')}</Td>
                  <Td className="text-right">{admin && <Button variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate(g)}>{g.is_active ? 'Turn off' : 'Turn on'}</Button>}</Td>
                </tr>
              ))}
            </Table>
          )}
          <ErrorNote error={toggle.error} />
          <p className="mt-3 text-xs text-slate-500">Entry and exit are detected on the server from accurate location fixes and need the set number of confirming fixes, so GPS jitter is not counted as a visit. Exit alerts notify admins (and a manager for their team) through the bell as soon as an exit is confirmed.</p>
        </Card>
      </div>
      {admin && (
        <Card title="Add geofence">
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); add.mutate() }} className="space-y-3">
            <Field label="Name"><Input required value={f.name} onChange={set('name')} /></Field>
            <Field label="Type"><Select value={f.type} onChange={set('type')}>{GEOFENCE_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</Select></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Latitude"><Input required inputMode="decimal" value={f.latitude} onChange={set('latitude')} placeholder="14.7921" /></Field>
              <Field label="Longitude"><Input required inputMode="decimal" value={f.longitude} onChange={set('longitude')} placeholder="75.4044" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Radius (m)" hint="10 – 50,000"><Input required inputMode="numeric" value={f.radius_m} onChange={set('radius_m')} /></Field>
              <Field label="Confirming fixes" hint="1 – 10"><Input required inputMode="numeric" value={f.hysteresis_fixes} onChange={set('hysteresis_fixes')} /></Field>
            </div>
            <p className="text-xs text-slate-500">Tip: in Google Maps, right-click a place and copy its coordinates.</p>
            {formErr && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formErr}</p>}
            <Button type="submit" disabled={add.isPending} className="w-full">Add geofence</Button>
          </form>
        </Card>
      )}
    </div>
  )
}

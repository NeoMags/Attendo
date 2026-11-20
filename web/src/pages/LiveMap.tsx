import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AdvancedMarker, APIProvider, InfoWindow, Map, Pin } from '@vis.gl/react-google-maps'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { env } from '@/lib/env'
import { humanAge } from '@/lib/format'
import { TONE_COLOR, toPins, type LiveStatus } from '@/lib/livemap'
import { Badge, Card, ErrorNote, Spinner, Table, Td } from '@/components/ui'

export default function LiveMap() {
  const { companyId } = useAuth()
  const [sel, setSel] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['live', companyId], enabled: !!companyId, refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_status_v')
        .select('employee_id, employee_code, full_name, is_checked_in, last_lat, last_lng, seconds_since_fix, health_status, last_battery')
        .eq('company_id', companyId!).eq('is_checked_in', true)
      if (error) throw error
      return data as LiveStatus[]
    },
  })
  const pins = useMemo(() => toPins(q.data ?? []), [q.data])
  const selected = pins.find((p) => p.employee_id === sel)

  if (!companyId) return <p className="text-sm text-slate-600">Select a company first.</p>
  if (q.isLoading) return <Spinner />
  if (q.error) return <ErrorNote error={q.error} />
  const noPos = (q.data ?? []).length - pins.length

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Live map</h1>
        <span className="text-xs text-slate-500">Refreshes every 15 s · {pins.length} on map{noPos ? ` · ${noPos} without a position` : ''}</span>
      </div>
      {env.googleMapsApiKey ? (
        <div className="h-[60vh] overflow-hidden rounded-lg border border-slate-200">
          <APIProvider apiKey={env.googleMapsApiKey}>
            <Map mapId="DEMO_MAP_ID" defaultCenter={{ lat: 20.59, lng: 78.96 }} defaultZoom={5} gestureHandling="greedy" disableDefaultUI={false}
              {...(pins.length === 0 ? {} : { defaultBounds: boundsOf(pins) })}>
              {pins.map((p) => (
                <AdvancedMarker key={p.employee_id} position={p} title={p.full_name} onClick={() => setSel(p.employee_id)}>
                  <Pin background={TONE_COLOR[p.tone]} borderColor="#0f172a" glyphColor="#fff" />
                </AdvancedMarker>
              ))}
              {selected && (
                <InfoWindow position={selected} onCloseClick={() => setSel(null)}>
                  <div className="text-sm"><strong>{selected.full_name}</strong><br />{selected.employee_code}<br />Fix {humanAge(selected.seconds_since_fix)}{selected.last_battery != null ? ` · battery ${selected.last_battery}%` : ''}</div>
                </InfoWindow>
              )}
            </Map>
          </APIProvider>
        </div>
      ) : (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">Map unavailable: VITE_GOOGLE_MAPS_API_KEY is not set. The list below still works.</p>
      )}
      <Card title="Positions">
        <Table head={['Employee', 'Last fix', 'Status', 'Coordinates']} empty={pins.length ? undefined : 'No checked-in employee has a position yet.'}>
          {pins.map((p) => (
            <tr key={p.employee_id} className="cursor-pointer" onClick={() => setSel(p.employee_id)}>
              <Td>{p.full_name} <span className="text-slate-400">({p.employee_code})</span></Td>
              <Td>{humanAge(p.seconds_since_fix)}</Td>
              <Td><Badge tone={p.tone === 'stale' ? 'muted' : p.tone}>{p.tone === 'stale' ? 'stale' : p.health_status ?? 'ok'}</Badge></Td>
              <Td className="font-mono text-xs">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}

function boundsOf(pins: { lat: number; lng: number }[]) {
  const lats = pins.map((p) => p.lat), lngs = pins.map((p) => p.lng)
  const pad = 0.005
  return { north: Math.max(...lats) + pad, south: Math.min(...lats) - pad, east: Math.max(...lngs) + pad, west: Math.min(...lngs) - pad }
}

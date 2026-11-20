import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AdvancedMarker, APIProvider, Map, Pin, useMap } from '@vis.gl/react-google-maps'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { env } from '@/lib/env'
import { fmtDuration, fmtTime, todayIn } from '@/lib/format'
import { cleanTrack, projectToBox, summarize, type TrackPoint } from '@/lib/route'
import { Badge, Button, Card, ErrorNote, Field, Input, Select, Spinner, Stat, Table, Td } from '@/components/ui'

interface Rec { latitude: number; longitude: number; accuracy: number | null; is_mock: boolean; recorded_at: string }
interface Intr { id: string; started_at: string; ended_at: string | null; reason: string }
const PAGE = 1000, MAX_PAGES = 10

export default function Routes() {
  const { companyId, company } = useAuth()
  const tz = company?.timezone
  const [empId, setEmpId] = useState('')
  const [date, setDate] = useState(() => todayIn(tz))
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)

  const emps = useQuery({
    queryKey: ['route-emps', companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id, employee_code, full_name').eq('company_id', companyId!).order('full_name')
      if (error) throw error
      return data
    },
  })

  const day = useQuery({
    queryKey: ['route', companyId, empId, date], enabled: !!companyId && !!empId,
    queryFn: async () => {
      const { data: att, error: e1 } = await supabase.from('attendance').select('id, check_in_at, check_out_at')
        .eq('company_id', companyId!).eq('employee_id', empId).eq('work_date', date).order('check_in_at')
      if (e1) throw e1
      // Privacy audit trail: record that this admin viewed this employee's route (non-blocking; a failure must not hide the data).
      void supabase.rpc('log_admin_access', { p_action: 'route_history', p_employee_id: empId, p_details: { date } }).then(({ error }) => { if (error) console.warn('audit log failed', error.message) })
      if (!att.length) return { att, recs: [] as Rec[], intr: [] as Intr[], truncated: false }
      const from = att[0].check_in_at
      const last = att[att.length - 1]
      const to = last.check_out_at ?? new Date().toISOString()
      const recs: Rec[] = []
      let truncated = false
      for (let p = 0; p < MAX_PAGES; p++) {
        const { data, error } = await supabase.from('location_records').select('latitude, longitude, accuracy, is_mock, recorded_at')
          .eq('company_id', companyId!).eq('employee_id', empId).gte('recorded_at', from).lte('recorded_at', to)
          .order('recorded_at').range(p * PAGE, p * PAGE + PAGE - 1)
        if (error) throw error
        recs.push(...(data as Rec[]))
        if (data.length < PAGE) break
        if (p === MAX_PAGES - 1) truncated = true
      }
      const { data: intr, error: e3 } = await supabase.from('tracking_interruptions').select('id, started_at, ended_at, reason')
        .eq('company_id', companyId!).eq('employee_id', empId).gte('started_at', from).lte('started_at', to).order('started_at')
      if (e3) throw e3
      return { att, recs, intr: intr as Intr[], truncated }
    },
  })

  const raw: TrackPoint[] = useMemo(() => (day.data?.recs ?? []).map((r) => ({
    lat: r.latitude, lng: r.longitude, accuracy: r.accuracy, isMock: r.is_mock, t: Date.parse(r.recorded_at),
  })), [day.data])
  const track = useMemo(() => cleanTrack(raw).track, [raw])
  const sum = useMemo(() => summarize(raw), [raw])
  const cur = track[Math.min(idx, Math.max(0, track.length - 1))]

  useEffect(() => { setIdx(0); setPlaying(false) }, [empId, date])
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setIdx((i) => { if (i >= track.length - 1) { setPlaying(false); return i } return i + 1 }), 300)
    return () => clearInterval(id)
  }, [playing, track.length])

  if (!companyId) return <p className="text-sm text-slate-600">Select a company first.</p>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-lg font-semibold">Route history</h1>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Employee">
            <Select value={empId} onChange={(e) => setEmpId(e.target.value)}>
              <option value="">Select…</option>
              {emps.data?.map((e) => <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>)}
            </Select>
          </Field>
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
      </div>
      <ErrorNote error={emps.error} />
      {!empId ? <p className="text-sm text-slate-600">Choose an employee and a date.</p>
        : day.isLoading ? <Spinner /> : day.error ? <ErrorNote error={day.error} />
        : !day.data!.att.length ? <p className="text-sm text-slate-600">No attendance on this date.</p> : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Stat label="Distance" value={`${(sum.distanceM / 1000).toFixed(2)} km`} />
              <Stat label="Moving" value={fmtDuration(sum.movingS)} />
              <Stat label="Stopped" value={fmtDuration(sum.stoppedS)} />
              <Stat label="Stops (5+ min)" value={sum.stops.length} />
              <Stat label="Top speed" value={`${Math.round(sum.maxSpeedKmh)} km/h`} />
            </div>
            <p className="text-xs text-slate-500">
              {sum.used} of {sum.points} points used{sum.dropped ? ` · ${sum.dropped} dropped (accuracy over 100 m, impossible jumps or mock location)` : ''}
              {sum.mockPoints ? ` · ${sum.mockPoints} flagged as mock location` : ''}. Gaps over 20 min are not counted as movement.
              {day.data!.truncated ? ' Showing only the first 10,000 points.' : ''}
            </p>
            {track.length === 0 ? <p className="text-sm text-slate-600">No usable location points for this day.</p> : (
              <Card>
                <RouteView track={track} cur={cur} stops={sum.stops} />
                <div className="mt-3 flex items-center gap-3">
                  <Button variant="ghost" onClick={() => { if (idx >= track.length - 1) setIdx(0); setPlaying((p) => !p) }}>{playing ? 'Pause' : 'Play'}</Button>
                  <input aria-label="Playback position" type="range" min={0} max={track.length - 1} value={idx} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)) }} className="flex-1" />
                  <span className="w-20 text-right text-sm tabular-nums">{fmtTime(new Date(cur.t).toISOString(), tz)}</span>
                </div>
              </Card>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Stops">
                <Table head={['From', 'To', 'Duration']} empty={sum.stops.length ? undefined : 'No stops of 5 minutes or more.'}>
                  {sum.stops.map((s) => <tr key={s.start}><Td>{fmtTime(new Date(s.start).toISOString(), tz)}</Td><Td>{fmtTime(new Date(s.end).toISOString(), tz)}</Td><Td>{fmtDuration(s.durationS)}</Td></tr>)}
                </Table>
              </Card>
              <Card title="Tracking interruptions">
                <Table head={['From', 'To', 'Reason']} empty={day.data!.intr.length ? undefined : 'None recorded.'}>
                  {day.data!.intr.map((i) => <tr key={i.id}><Td>{fmtTime(i.started_at, tz)}</Td><Td>{i.ended_at ? fmtTime(i.ended_at, tz) : <Badge tone="warn">ongoing</Badge>}</Td><Td>{i.reason.replaceAll('_', ' ')}</Td></tr>)}
                </Table>
              </Card>
            </div>
          </>
        )}
    </div>
  )
}

function RouteView({ track, cur, stops }: { track: TrackPoint[]; cur: TrackPoint; stops: { lat: number; lng: number; start: number }[] }) {
  if (env.googleMapsApiKey) {
    return (
      <div className="h-[55vh] overflow-hidden rounded-lg border border-slate-200">
        <APIProvider apiKey={env.googleMapsApiKey}>
          <Map mapId="DEMO_MAP_ID" defaultCenter={cur} defaultZoom={15} gestureHandling="greedy">
            <PathLine track={track} />
            {stops.map((s) => <AdvancedMarker key={s.start} position={s}><Pin background="#d97706" glyphColor="#fff" borderColor="#0f172a" scale={0.8} /></AdvancedMarker>)}
            <AdvancedMarker position={cur}><Pin background="#2563eb" glyphColor="#fff" borderColor="#0f172a" /></AdvancedMarker>
          </Map>
        </APIProvider>
      </div>
    )
  }
  const W = 640, H = 360
  const pts = projectToBox(track, W, H)
  const i = track.indexOf(cur)
  const sp = projectToBox([...track, ...stops], W, H).slice(track.length)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-slate-200 bg-slate-50" role="img" aria-label="Route preview without a map">
        <polyline fill="none" stroke="#64748b" strokeWidth="2" points={pts.map((p) => `${p.x},${p.y}`).join(' ')} />
        {sp.map((p, k) => <circle key={k} cx={p.x} cy={p.y} r="6" fill="#d97706" />)}
        {pts[i] && <circle cx={pts[i].x} cy={pts[i].y} r="7" fill="#2563eb" stroke="#0f172a" />}
      </svg>
      <p className="mt-1 text-xs text-slate-500">Schematic preview. Set VITE_GOOGLE_MAPS_API_KEY to see the route on a map.</p>
    </div>
  )
}

function PathLine({ track }: { track: TrackPoint[] }) {
  const map = useMap()
  useEffect(() => {
    if (!map || !track.length) return
    const line = new google.maps.Polyline({ path: track.map((p) => ({ lat: p.lat, lng: p.lng })), strokeColor: '#2563eb', strokeOpacity: 0.8, strokeWeight: 4, map })
    const b = new google.maps.LatLngBounds()
    track.forEach((p) => b.extend({ lat: p.lat, lng: p.lng }))
    map.fitBounds(b, 40)
    return () => line.setMap(null)
  }, [map, track])
  return null
}

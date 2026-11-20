import type { GeoPoint } from './geo'

export interface LiveStatus {
  employee_id: string; employee_code: string; full_name: string; is_checked_in: boolean
  last_lat: number | null; last_lng: number | null; seconds_since_fix: number | null
  health_status: 'healthy' | 'degraded' | 'interrupted' | null; last_battery?: number | null
}
export type PinTone = 'good' | 'warn' | 'bad' | 'stale'

export const STALE_AFTER_S = 15 * 60

/** Checked-in employees with a usable position, with a colour tone. Stale fixes are flagged, never hidden. */
export function toPins(rows: LiveStatus[]): (LiveStatus & GeoPoint & { tone: PinTone })[] {
  const out: (LiveStatus & GeoPoint & { tone: PinTone })[] = []
  for (const r of rows) {
    if (!r.is_checked_in || r.last_lat == null || r.last_lng == null) continue
    if (!Number.isFinite(r.last_lat) || !Number.isFinite(r.last_lng) || Math.abs(r.last_lat) > 90 || Math.abs(r.last_lng) > 180) continue
    const stale = r.seconds_since_fix == null || r.seconds_since_fix > STALE_AFTER_S
    const tone: PinTone = r.health_status === 'interrupted' ? 'bad' : stale ? 'stale' : r.health_status === 'degraded' ? 'warn' : 'good'
    out.push({ ...r, lat: r.last_lat, lng: r.last_lng, tone })
  }
  return out
}

export const TONE_COLOR: Record<PinTone, string> = { good: '#059669', warn: '#d97706', bad: '#dc2626', stale: '#64748b' }

import { haversineMeters, type GeoPoint } from './geo'

export interface TrackPoint extends GeoPoint {
  t: number // epoch ms (device recorded_at)
  accuracy: number | null
  isMock?: boolean
}
export interface Stop { lat: number; lng: number; start: number; end: number; durationS: number }
export interface RouteSummary {
  points: number; used: number; dropped: number; distanceM: number
  durationS: number; movingS: number; stoppedS: number; stops: Stop[]; maxSpeedKmh: number; mockPoints: number
}

export const MAX_ACCURACY_M = 100
export const MAX_SPEED_MS = 70 // ~250 km/h: faster implies a GPS jump
export const STOP_RADIUS_M = 50
export const STOP_MIN_S = 300
/** A gap longer than this is not counted as movement or stop time (tracking was off or unreported). */
export const GAP_S = 20 * 60

/** Sort, drop inaccurate fixes and impossible jumps. Mock points are kept out of the track but counted. */
export function cleanTrack(raw: TrackPoint[]): { track: TrackPoint[]; dropped: number; mock: number } {
  const sorted = [...raw].sort((a, b) => a.t - b.t)
  const track: TrackPoint[] = []
  let dropped = 0, mock = 0
  for (const p of sorted) {
    if (p.isMock) { mock++; dropped++; continue }
    if (p.accuracy != null && p.accuracy > MAX_ACCURACY_M) { dropped++; continue }
    const prev = track[track.length - 1]
    if (prev) {
      const dt = (p.t - prev.t) / 1000
      if (dt <= 0) { dropped++; continue }
      if (haversineMeters(prev, p) / dt > MAX_SPEED_MS) { dropped++; continue }
    }
    track.push(p)
  }
  return { track, dropped, mock }
}

export function detectStops(track: TrackPoint[]): Stop[] {
  const stops: Stop[] = []
  let i = 0
  while (i < track.length) {
    let j = i + 1
    while (j < track.length && haversineMeters(track[i], track[j]) <= STOP_RADIUS_M && (track[j].t - track[j - 1].t) / 1000 <= GAP_S) j++
    const durationS = (track[j - 1].t - track[i].t) / 1000
    if (j - 1 > i && durationS >= STOP_MIN_S) {
      const seg = track.slice(i, j)
      stops.push({
        lat: seg.reduce((s, p) => s + p.lat, 0) / seg.length,
        lng: seg.reduce((s, p) => s + p.lng, 0) / seg.length,
        start: track[i].t, end: track[j - 1].t, durationS,
      })
      i = j
    } else i++
  }
  return stops
}

export function summarize(raw: TrackPoint[]): RouteSummary {
  const { track, dropped, mock } = cleanTrack(raw)
  let distanceM = 0, movingS = 0, stoppedS = 0, maxMs = 0
  const stops = detectStops(track)
  for (let k = 1; k < track.length; k++) {
    const dt = (track[k].t - track[k - 1].t) / 1000
    if (dt > GAP_S) continue
    const d = haversineMeters(track[k - 1], track[k])
    const inStop = stops.some((s) => track[k - 1].t >= s.start && track[k].t <= s.end)
    if (inStop) { stoppedS += dt; continue }
    distanceM += d; movingS += dt
    maxMs = Math.max(maxMs, d / dt)
  }
  return {
    points: raw.length, used: track.length, dropped, distanceM, movingS, stoppedS, stops, mockPoints: mock,
    durationS: track.length > 1 ? (track[track.length - 1].t - track[0].t) / 1000 : 0,
    maxSpeedKmh: maxMs * 3.6,
  }
}

/** Project points to an SVG viewBox (equirectangular; fine at city scale) for the no-map fallback. */
export function projectToBox(pts: GeoPoint[], w: number, h: number, pad = 12): { x: number; y: number }[] {
  if (!pts.length) return []
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length
  const kx = Math.cos((lat0 * Math.PI) / 180)
  const xs = pts.map((p) => p.lng * kx), ys = pts.map((p) => p.lat)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const scale = Math.min((w - 2 * pad) / (maxX - minX || 1e-9), (h - 2 * pad) / (maxY - minY || 1e-9))
  return pts.map((_, i) => ({ x: pad + (xs[i] - minX) * scale, y: h - pad - (ys[i] - minY) * scale }))
}

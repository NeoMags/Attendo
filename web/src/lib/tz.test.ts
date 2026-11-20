import { describe, expect, it } from 'vitest'
import { utcIsoToZoned, zonedToUtcIso } from './tz'
import { validateGeofence } from './geofence'

describe('tz', () => {
  it('converts Asia/Kolkata wall time to UTC (+5:30)', () => {
    expect(zonedToUtcIso('2026-11-20T09:30', 'Asia/Kolkata')).toBe('2026-11-20T04:00:00.000Z')
  })
  it('handles negative offsets and DST (America/New_York)', () => {
    expect(zonedToUtcIso('2026-07-01T12:00', 'America/New_York')).toBe('2026-07-01T16:00:00.000Z')
    expect(zonedToUtcIso('2026-12-01T12:00', 'America/New_York')).toBe('2026-12-01T17:00:00.000Z')
  })
  it('round-trips', () => {
    const iso = zonedToUtcIso('2026-11-20T23:45', 'Asia/Kolkata')!
    expect(utcIsoToZoned(iso, 'Asia/Kolkata')).toBe('2026-11-20T23:45')
  })
  it('rejects malformed input', () => {
    expect(zonedToUtcIso('', 'Asia/Kolkata')).toBeNull()
    expect(zonedToUtcIso('2026-11-20 09:30', 'Asia/Kolkata')).toBeNull()
  })
})
describe('validateGeofence', () => {
  const ok = { name: ' HQ ', type: 'office', latitude: '14.79', longitude: '75.4', radius_m: '150', hysteresis_fixes: '2' }
  it('accepts and trims', () => { const r = validateGeofence(ok); expect(r.ok && r.value.name).toBe('HQ') })
  it('rejects bad values', () => {
    for (const bad of [{ name: '' }, { type: 'x' }, { latitude: '91' }, { longitude: '' }, { radius_m: '5' }, { radius_m: '60000' }, { hysteresis_fixes: '2.5' }, { latitude: 'abc' }])
      expect(validateGeofence({ ...ok, ...bad }).ok).toBe(false)
  })
})

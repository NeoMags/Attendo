import { describe, expect, it } from 'vitest'
import { toPins, type LiveStatus } from './livemap'

const base: LiveStatus = { employee_id: '1', employee_code: 'E1', full_name: 'A', is_checked_in: true, last_lat: 12.9, last_lng: 77.6, seconds_since_fix: 30, health_status: 'healthy' }
describe('toPins', () => {
  it('skips checked-out, no-fix and invalid coordinates', () => {
    expect(toPins([{ ...base, is_checked_in: false }, { ...base, last_lat: null }, { ...base, last_lat: 95 }, { ...base, last_lng: NaN }])).toEqual([])
  })
  it('assigns tones', () => {
    const t = (o: Partial<LiveStatus>) => toPins([{ ...base, ...o }])[0].tone
    expect(t({})).toBe('good')
    expect(t({ health_status: 'degraded' })).toBe('warn')
    expect(t({ health_status: 'interrupted' })).toBe('bad')
    expect(t({ seconds_since_fix: 3600 })).toBe('stale')
    expect(t({ seconds_since_fix: null })).toBe('stale')
  })
})

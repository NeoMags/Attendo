import { describe, expect, it } from 'vitest'
import { haversineMeters } from './geo'

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMeters({ lat: 15.45, lng: 75.0 }, { lat: 15.45, lng: 75.0 })).toBe(0)
  })

  it('one degree of latitude is about 111.2 km', () => {
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })
    expect(d).toBeGreaterThan(111_000)
    expect(d).toBeLessThan(111_400)
  })

  it('is symmetric', () => {
    const a = { lat: 12.9716, lng: 77.5946 }
    const b = { lat: 15.4589, lng: 75.0078 }
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6)
  })
})

import { describe, expect, it } from 'vitest'
import { cleanTrack, detectStops, projectToBox, summarize, type TrackPoint } from './route'

const M = 1 / 111_320 // degrees lat per metre
const pt = (sec: number, northM: number, extra: Partial<TrackPoint> = {}): TrackPoint => ({ t: sec * 1000, lat: 12 + northM * M, lng: 77, accuracy: 10, ...extra })

describe('cleanTrack', () => {
  it('drops inaccurate, mock, duplicate-time and teleport points', () => {
    const { track, dropped, mock } = cleanTrack([pt(0, 0), pt(10, 5, { accuracy: 500 }), pt(20, 10, { isMock: true }), pt(30, 20), pt(30, 21), pt(40, 50_000)])
    expect(track.length).toBe(2)
    expect(dropped).toBe(4)
    expect(mock).toBe(1)
  })
  it('sorts out-of-order input', () => {
    expect(cleanTrack([pt(20, 20), pt(0, 0), pt(10, 10)]).track.map((p) => p.t)).toEqual([0, 10000, 20000])
  })
})
describe('summarize', () => {
  it('measures a straight 1 km walk', () => {
    const pts = Array.from({ length: 11 }, (_, i) => pt(i * 60, i * 100))
    const s = summarize(pts)
    expect(s.distanceM).toBeGreaterThan(990)
    expect(s.distanceM).toBeLessThan(1010)
    expect(s.stops).toHaveLength(0)
    expect(s.movingS).toBe(600)
  })
  it('detects a stop and excludes it from distance', () => {
    const pts = [pt(0, 0), pt(60, 100), ...Array.from({ length: 8 }, (_, i) => pt(120 + i * 60, 100 + (i % 2) * 3)), pt(700, 200)]
    const s = summarize(pts)
    expect(s.stops).toHaveLength(1)
    expect(s.stops[0].durationS).toBeGreaterThanOrEqual(300)
    expect(s.stoppedS).toBeGreaterThan(0)
  })
  it('does not count long gaps as movement', () => {
    const s = summarize([pt(0, 0), pt(3600, 500)])
    expect(s.distanceM).toBe(0)
    expect(s.movingS).toBe(0)
  })
  it('handles empty and single point', () => {
    expect(summarize([]).distanceM).toBe(0)
    expect(summarize([pt(0, 0)]).durationS).toBe(0)
    expect(detectStops([])).toEqual([])
  })
})
describe('projectToBox', () => {
  it('stays inside the box and handles one point', () => {
    const out = projectToBox([{ lat: 12, lng: 77 }, { lat: 12.01, lng: 77.02 }], 300, 200)
    for (const p of out) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(300); expect(p.y).toBeLessThanOrEqual(200) }
    expect(projectToBox([{ lat: 1, lng: 1 }], 100, 100)).toHaveLength(1)
  })
})

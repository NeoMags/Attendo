import { describe, expect, it } from 'vitest'
import { DEFAULT_CARDS, moveCard, normalizeLayout, replaceCard } from './cards'
import { unreadCount } from './notify'
import { nowParts } from './clock'

describe('cards', () => {
  it('defaults when nothing saved, keeps explicit empty', () => {
    expect(normalizeLayout(null)).toEqual(DEFAULT_CARDS)
    expect(normalizeLayout([])).toEqual([])
    expect(normalizeLayout('x')).toEqual(DEFAULT_CARDS)
  })
  it('drops unknown and duplicate ids, keeps order', () => {
    expect(normalizeLayout(['late', 'nope', 'active', 'late', 5])).toEqual(['late', 'active'])
  })
  it('moves within bounds only', () => {
    expect(moveCard(['active', 'late'], 'late', -1)).toEqual(['late', 'active'])
    expect(moveCard(['active', 'late'], 'active', -1)).toEqual(['active', 'late'])
  })
  it('replaces in place without creating duplicates', () => {
    expect(replaceCard(['active', 'late'], 'late', 'absent')).toEqual(['active', 'absent'])
    expect(replaceCard(['active', 'late'], 'late', 'active')).toEqual(['active', 'late'])
  })
})

describe('notifications + clock', () => {
  const n = (t: string) => ({ id: t, kind: 'k', title: 't', body: null, created_at: t, data: {} })
  it('counts only items newer than seen time', () => {
    const list = [n('2026-11-23T10:00:00Z'), n('2026-11-23T08:00:00Z')]
    expect(unreadCount(list, '2026-11-23T09:00:00Z')).toBe(1)
    expect(unreadCount(list, '2026-11-23T11:00:00Z')).toBe(0)
  })
  it('without seen time only last 7 days count', () => {
    const now = Date.parse('2026-11-23T12:00:00Z')
    expect(unreadCount([n('2026-11-20T00:00:00Z'), n('2026-10-01T00:00:00Z')], null, now)).toBe(1)
  })
  it('formats day/date/time in the company zone', () => {
    const p = nowParts('Asia/Kolkata', new Date('2026-11-23T08:30:15Z'))
    expect(p.date).toBe('Monday, 23 November 2026'); expect(p.time).toBe('14:00:15')
  })
})

import { visitStatus } from './schedule'
describe('visitStatus', () => {
  const s = { id: '1', employee_id: 'e', geofence_id: 'g', schedule_date: '2026-11-20', start_time: '09:00:00', end_time: '10:00:00', title: 'x' }
  it('visited / missed / pending / no_site', () => {
    expect(visitStatus(s, [{ employee_id: 'e', geofence_id: 'g', date: '2026-11-20' }], '2026-11-23')).toBe('visited')
    expect(visitStatus(s, [{ employee_id: 'e', geofence_id: 'g', date: '2026-11-19' }], '2026-11-23')).toBe('missed')
    expect(visitStatus({ ...s, schedule_date: '2026-11-25' }, [], '2026-11-23')).toBe('pending')
    expect(visitStatus({ ...s, geofence_id: null }, [], '2026-11-23')).toBe('no_site')
  })
})

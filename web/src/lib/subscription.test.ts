import { describe, expect, it } from 'vitest'
import { bannerFor, isReadOnly, newPasswordProblem, type MySubscription } from './subscription'

const sub = (o: Partial<MySubscription>): MySubscription => ({ state: 'active', plan_name: 'Starter', max_employees: 10, employee_count: 3, expires_on: '2026-12-31', days_left: 30, is_complimentary: false, ...o })

describe('bannerFor', () => {
  it('is silent for a healthy plan, complimentary plans, employees and missing data', () => {
    expect(bannerFor(sub({}), 'company_admin')).toBeNull()
    expect(bannerFor(sub({ is_complimentary: true, state: 'expired' }), 'company_admin')).toBeNull()
    expect(bannerFor(sub({ days_left: 2 }), 'employee')).toBeNull()
    expect(bannerFor(sub({ days_left: 2 }), 'super_admin')).toBeNull()
    expect(bannerFor(null, 'company_admin')).toBeNull()
  })
  it('warns during the last 7 days, with wording by distance', () => {
    expect(bannerFor(sub({ days_left: 8 }), 'company_admin')).toBeNull()
    expect(bannerFor(sub({ days_left: 7 }), 'company_admin')?.title).toBe('Your plan ends in 7 days')
    expect(bannerFor(sub({ days_left: 1 }), 'company_admin')?.title).toBe('Your plan ends tomorrow')
    expect(bannerFor(sub({ days_left: 0 }), 'company_admin')?.title).toBe('Your plan ends today')
    expect(bannerFor(sub({ days_left: 3 }), 'company_admin')?.tone).toBe('warn')
  })
  it('flags grace and expired as errors that mention read-only', () => {
    const g = bannerFor(sub({ state: 'grace', days_left: -1 }), 'company_admin')!
    expect(g.tone).toBe('bad'); expect(g.text).toContain('read-only'); expect(g.text).toContain('still works')
    const e = bannerFor(sub({ state: 'expired', days_left: -9 }), 'company_admin')!
    expect(e.text).toContain('employee app has stopped')
  })
  it('only company admins are offered the renew action; managers are told to ask', () => {
    expect(bannerFor(sub({ days_left: 2 }), 'company_admin')?.renew).toBe(true)
    const m = bannerFor(sub({ days_left: 2 }), 'manager')!
    expect(m.renew).toBe(false); expect(m.text).toContain('Ask your administrator')
  })
})

describe('isReadOnly', () => {
  it('is true only for grace and expired', () => {
    expect(isReadOnly(sub({ state: 'grace' }))).toBe(true)
    expect(isReadOnly(sub({ state: 'expired' }))).toBe(true)
    expect(isReadOnly(sub({ state: 'active' }))).toBe(false)
    expect(isReadOnly(null)).toBe(false)
  })
})

describe('newPasswordProblem', () => {
  it('enforces length, letters+digits and confirmation', () => {
    expect(newPasswordProblem('abc123', 'abc123')).toMatch(/8 to 72/)
    expect(newPasswordProblem('a'.repeat(73), 'a'.repeat(73))).toMatch(/8 to 72/)
    expect(newPasswordProblem('abcdefgh', 'abcdefgh')).toMatch(/letters and digits/)
    expect(newPasswordProblem('12345678', '12345678')).toMatch(/letters and digits/)
    expect(newPasswordProblem('abcd1234', 'abcd12345')).toMatch(/do not match/)
    expect(newPasswordProblem('abcd1234', 'abcd1234')).toBeNull()
  })
})

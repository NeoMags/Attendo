import { describe, expect, it } from 'vitest'
import { emptyPlanForm, loginMessage, parsePlanForm, relatedRequests, UPI_RE, type SubscriptionRequest } from './subscriptions'

const base = (o: Partial<SubscriptionRequest>): SubscriptionRequest => ({
  id: 'x', reference: 'SR-1', kind: 'new', status: 'pending', plan_name: 'Starter', amount_inr: 999, max_employees: 10, duration_months: 1,
  applicant_name: 'A', company_name: 'C', email: 'a@x.in', phone: '9845012345', utr: 'AAAAAAAAAAAA', receipt_path: 'p/receipt.png',
  company_id: null, approved_company_id: null, reviewed_at: null, reject_reason: null, created_at: '2026-11-28T00:00:00Z', ...o,
})

describe('parsePlanForm', () => {
  const ok = { ...emptyPlanForm(), name: ' Pro ', price: '4999.50', max_employees: '100', duration_months: '3' }
  it('parses a valid plan and trims text', () => {
    const r = parsePlanForm(ok)
    expect('row' in r && r.row).toMatchObject({ name: 'Pro', price_inr: 4999.5, max_employees: 100, duration_months: 3, description: null, is_active: true })
  })
  it.each([
    ['name', { name: ' ' }], ['price', { price: '' }], ['price', { price: '-1' }], ['price', { price: '10.999' }],
    ['employees', { max_employees: '0' }], ['employees', { max_employees: '2.5' }], ['months', { duration_months: '37' }], ['months', { duration_months: '0' }],
  ])('rejects bad %s', (_n, patch) => { expect(parsePlanForm({ ...ok, ...patch })).toHaveProperty('error') })
  it('allows a free plan', () => { expect(parsePlanForm({ ...ok, price: '0' })).toHaveProperty('row') })
})

describe('relatedRequests', () => {
  const r = base({ id: '1' })
  it('flags matching UTR, email and phone (with or without +91) in other requests', () => {
    const hits = relatedRequests(r, [r, base({ id: '2', reference: 'SR-2', utr: 'AAAAAAAAAAAA', status: 'rejected' }), base({ id: '3', reference: 'SR-3', utr: 'BBBBBBBBBBBB', email: 'a@x.in' }), base({ id: '4', reference: 'SR-4', utr: 'CCCCCCCCCCCC', email: 'b@x.in', phone: '+919845012345' })])
    expect(hits.map((h) => [h.request.id, h.why.join(',')])).toEqual([['2', 'same UTR,same email,same phone'], ['3', 'same email,same phone'], ['4', 'same phone']])
  })
  it('returns nothing for unrelated requests and never the request itself', () => {
    expect(relatedRequests(r, [r, base({ id: '9', utr: 'ZZZZZZZZZZZZ', email: 'z@x.in', phone: '9000000000' })])).toEqual([])
  })
})

describe('UPI_RE and loginMessage', () => {
  it('accepts typical UPI IDs and rejects malformed ones', () => {
    for (const v of ['shop@okhdfc', 'name.surname-1@ybl', '9845012345@paytm']) expect(UPI_RE.test(v)).toBe(true)
    for (const v of ['noatsign', '@bank', 'a@b', 'sp ace@bank', 'x@1bank']) expect(UPI_RE.test(v)).toBe(false)
  })
  it('builds a customer message with username, password and sign-in link', () => {
    const m = loginMessage({ kind: 'new', company_id: 'c', company_name: 'Co', company_code: 'co', email: 'a@x.in', temporary_password: 'Abc23456xyzK', plan: null, max_employees: null, expires_on: null }, 'https://app.example')
    expect(m).toContain('https://app.example/login')
    expect(m).toContain('Username: a@x.in')
    expect(m).toContain('Temporary password: Abc23456xyzK')
  })
})

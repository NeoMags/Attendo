import { describe, expect, it } from 'vitest'
import { inr, monthLabel, monthStart, payError, payslipLines, rs } from './payroll'

describe('payroll helpers', () => {
  it('formats money in Indian grouping', () => {
    expect(inr(1234567.5)).toBe('₹12,34,567.50')
    expect(rs('1300')).toBe('Rs. 1,300.00')
    expect(inr(null)).toBe('₹0.00')
  })
  it('month helpers', () => {
    expect(monthStart('2026-02')).toBe('2026-02-01')
    expect(monthLabel('2026-02-01')).toMatch(/February 2026/)
  })
  it('payslip lines omit zero extras and net matches', () => {
    const a = payslipLines({ gross: 5000, bonus: 0, other_deduction: 0, advance_deduction: 0, net: 5000, pay_type: 'monthly' })
    expect(a.earnings).toEqual([['Salary for days paid', 5000]]); expect(a.deductions).toEqual([])
    const b = payslipLines({ gross: 5000, bonus: 200, other_deduction: 50, advance_deduction: 1000, net: 4150, pay_type: 'daily' })
    expect(b.earnings.map((x) => x[0])).toEqual(['Wages for days paid', 'Bonus / other earnings'])
    expect(b.deductions.map((x) => x[1])).toEqual([1000, 50])
    expect(b.earnings.reduce((s, x) => s + x[1], 0) - b.deductions.reduce((s, x) => s + x[1], 0)).toBe(b.net)
  })
  it('maps server error codes', () => {
    expect(payError('RUN_FINALIZED')).toMatch(/finalized/)
    expect(payError('zzz')).toBe('zzz')
  })
})

describe('payslipPdf', () => {
  it('produces a PDF blob', async () => {
    const { payslipPdf } = await import('./payroll')
    const p = { id: 'p', run_id: 'r', employee_id: 'e', month: '2026-02-01', pay_type: 'monthly', monthly_salary: 24000, daily_wage: null, working_days: 24, present_days: 5, holiday_days: 0, paid_leave_days: 0, unpaid_leave_days: 0, absent_days: 19, gross: 5000, bonus: 200, other_deduction: 0, skip_advance: false, advance_deduction: 1000, net: 4200, adjustment_note: null, finalized: true, paid_on: '2026-03-02', payment_mode: 'bank', employees: { full_name: 'Test', employee_code: 'E001' } } as const
    const blob = await payslipPdf({ p: p as never, companyName: 'Tatva', template: { id: 't', name: 'x', header_text: null, footer_text: 'Thanks', show_attendance: true, show_bank: true, accent: '#123456', is_default: true }, bankLine: 'Bank: X · A/c ending 1234' })
    const head = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5))
    expect(head).toBe('%PDF-')
    expect(blob.size).toBeGreaterThan(1500)
  })
})

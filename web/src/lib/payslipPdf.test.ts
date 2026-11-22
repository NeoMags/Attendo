// @ts-nocheck -- uses node:fs to load the bundled fonts; the app build does not include Node types
import { describe, expect, it } from 'vitest'

describe('payslipPdf', () => {
  const loadFont = async (f: string) => { const b = (await import('node:fs')).readFileSync(`public/fonts/${f}.ttf`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }
  const p = { id: 'p', run_id: 'r', employee_id: 'e', month: '2026-02-01', pay_type: 'monthly', monthly_salary: 24000, daily_wage: null, working_days: 24, present_days: 5.5, holiday_days: 0, paid_leave_days: 0.5, unpaid_leave_days: 0, absent_days: 18, gross: 5000, bonus: 200, other_deduction: 0, skip_advance: false, advance_deduction: 1000, net: 4200, adjustment_note: null, finalized: true, paid_on: '2026-03-02', payment_mode: 'bank', employees: { full_name: 'ಅಶೋಕ Kumar आशा', employee_code: 'E001' } }
  const tpl = { id: 't', name: 'x', header_text: null, footer_text: 'Thanks', show_attendance: true, show_bank: true, accent: '#123456', is_default: true }
  for (const lang of ['en', 'hi', 'kn'] as const) {
    it(`produces a PDF in ${lang}`, async () => {
      const { payslipPdf } = await import('./payroll')
      const blob = await payslipPdf({ p: p as never, companyName: 'Tatva', template: tpl, bankLine: 'Bank: X · A/c ending 1234', lang, loadFont })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
      expect(blob.size).toBeGreaterThan(5000)
      if (process.env.PDF_OUT) (await import('node:fs')).writeFileSync(`${process.env.PDF_OUT}/payslip-${lang}.pdf`, bytes)
    })
  }
})


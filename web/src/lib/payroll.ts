import { LABELS, monthIn, scriptRuns, type Lang } from './payslipI18n'
export interface Payslip {
  id: string; run_id: string; employee_id: string; month: string; pay_type: 'monthly' | 'daily'
  monthly_salary: number | null; daily_wage: number | null; working_days: number
  present_days: number; holiday_days: number; paid_leave_days: number; unpaid_leave_days: number; absent_days: number
  gross: number; bonus: number; other_deduction: number; skip_advance: boolean; advance_deduction: number; net: number
  adjustment_note: string | null; finalized: boolean; paid_on: string | null; payment_mode: string | null
  employees?: { full_name: string; employee_code: string; preferred_language?: string | null } | null
}
export interface Template { id: string; name: string; header_text: string | null; footer_text: string | null; show_attendance: boolean; show_bank: boolean; accent: string; is_default: boolean }

export const inr = (n: number | string | null | undefined) => `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** jsPDF's built-in font has no rupee glyph, so PDFs use "Rs.". */
export const rs = (n: number | string | null | undefined) => `Rs. ${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const monthLabel = (m: string) => new Date(`${m}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
/** First day of the month as YYYY-MM-01 from a <input type="month"> value (YYYY-MM). */
export const monthStart = (ym: string) => `${ym}-01`
export const currentYm = () => new Date().toLocaleDateString('en-CA').slice(0, 7)

export interface Lines { earnings: [string, number][]; deductions: [string, number][]; net: number }
/** Earnings and deductions shown on a payslip; zero extras are omitted. */
export function payslipLines(p: Pick<Payslip, 'gross' | 'bonus' | 'other_deduction' | 'advance_deduction' | 'net' | 'pay_type'>): Lines {
  const earnings: [string, number][] = [[p.pay_type === 'monthly' ? 'Salary for days paid' : 'Wages for days paid', p.gross]]
  if (p.bonus > 0) earnings.push(['Bonus / other earnings', p.bonus])
  const deductions: [string, number][] = []
  if (p.advance_deduction > 0) deductions.push(['Advance recovery', p.advance_deduction])
  if (p.other_deduction > 0) deductions.push(['Other deductions', p.other_deduction])
  return { earnings, deductions, net: p.net }
}

export interface PdfInput { p: Payslip; companyName: string; template?: Template | null; bankLine?: string | null; lang?: Lang; loadFont?: (file: string) => Promise<ArrayBuffer> }

const FONT_FILES = ['latin-400', 'latin-700', 'hi-400', 'hi-700', 'kn-400', 'kn-700']
const defaultLoad = async (file: string) => {
  const r = await fetch(`${import.meta.env.BASE_URL}fonts/${file}.ttf`)
  if (!r.ok) throw new Error(`Could not load font ${file}`)
  return r.arrayBuffer()
}
const b64 = (buf: ArrayBuffer) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) }
const fontsReady = new Map<string, Promise<void>>()

/** Payslip PDF with real Hindi/Kannada text (Noto fonts, shaped by pdfmake/fontkit). Fonts load on first use only. */
export async function payslipPdf({ p, companyName, template, bankLine, lang = 'en', loadFont = defaultLoad }: PdfInput): Promise<Blob> {
  const { default: pdfMake } = await import('pdfmake/build/pdfmake')
  const key = loadFont === defaultLoad ? 'default' : 'custom'
  if (!fontsReady.has(key)) {
    fontsReady.set(key, (async () => {
      const vfs: Record<string, string> = {}
      await Promise.all(FONT_FILES.map(async (f) => { vfs[`${f}.ttf`] = b64(await loadFont(f)) }))
      pdfMake.addVirtualFileSystem(vfs)
      pdfMake.addFonts({ latin: { normal: 'latin-400.ttf', bold: 'latin-700.ttf' }, hi: { normal: 'hi-400.ttf', bold: 'hi-700.ttf' }, kn: { normal: 'kn-400.ttf', bold: 'kn-700.ttf' } })
    })().catch((e) => { fontsReady.delete(key); throw e }))
  }
  await fontsReady.get(key)

  const L = LABELS[lang]
  const accent = template?.accent ?? '#0f172a'
  const txt = (s: string, o: Record<string, unknown> = {}) => ({ text: scriptRuns(s).map((r) => ({ text: r.text, font: r.script })), ...o })
  const money = (n: number) => rs(n).replace('Rs. ', '₹ ')
  const l = payslipLines(p)
  const lbl: Record<string, string> = { 'Salary for days paid': L.salaryDays, 'Wages for days paid': L.wagesDays, 'Bonus / other earnings': L.bonus, 'Advance recovery': L.advance, 'Other deductions': L.other }
  const table = (head: string, rows: [string, number][]) => ({
    margin: [0, 10, 0, 0] as [number, number, number, number],
    table: { widths: ['*', 120], body: [[txt(head, { bold: true, color: '#fff', fillColor: accent }), txt(L.amount, { bold: true, color: '#fff', fillColor: accent, alignment: 'right' })], ...rows.map(([k, v]) => [txt(lbl[k] ?? k), txt(money(v), { alignment: 'right' })])] },
    layout: 'lightHorizontalLines',
  })
  const days = [[L.workingDays, p.working_days], [L.present, p.present_days], [L.holidays, p.holiday_days], [L.paidLeave, p.paid_leave_days], [L.unpaidLeave, p.unpaid_leave_days], [L.absent, p.absent_days]] as const
  const content: unknown[] = [
    txt(template?.header_text?.trim() || companyName, { fontSize: 18, bold: true, color: accent }),
    txt(`${L.payslipFor} ${monthIn(p.month, lang)}`, { fontSize: 12, margin: [0, 4, 0, 0] }),
    txt(`${L.employee}: ${p.employees?.full_name ?? ''} (${p.employees?.employee_code ?? ''})`, { margin: [0, 6, 0, 0] }),
  ]
  if (bankLine && template?.show_bank) content.push(txt(bankLine, { margin: [0, 2, 0, 0], fontSize: 10 }))
  if (template?.show_attendance ?? true) {
    content.push({ margin: [0, 12, 0, 0], table: { widths: days.map(() => '*'), body: [days.map(([k]) => txt(k, { bold: true, fontSize: 8, fillColor: '#f1f5f9' })), days.map(([, v]) => txt(String(v), { fontSize: 10 }))] }, layout: 'lightHorizontalLines' })
  }
  content.push(table(L.earnings, l.earnings))
  if (l.deductions.length) content.push(table(L.deductions, l.deductions))
  content.push({ margin: [0, 16, 0, 0], columns: [txt(L.netPay, { fontSize: 14, bold: true, color: accent }), txt(money(l.net), { fontSize: 14, bold: true, color: accent, alignment: 'right' })] })
  if (p.adjustment_note) content.push(txt(`${L.note}: ${p.adjustment_note}`, { fontSize: 9, margin: [0, 8, 0, 0] }))
  content.push(txt(p.paid_on ? `${L.paidOn} ${p.paid_on} (${L.by}: ${L.modes[p.payment_mode ?? 'other'] ?? p.payment_mode})` : L.pending, { fontSize: 9, color: '#475569', margin: [0, 8, 0, 0] }))
  if (template?.footer_text) content.push(txt(template.footer_text, { fontSize: 9, color: '#475569', margin: [0, 14, 0, 0] }))
  content.push(txt(L.generated, { fontSize: 8, color: '#94a3b8', margin: [0, 24, 0, 0] }))

  return pdfMake.createPdf({ pageSize: 'A4', pageMargins: [40, 40, 40, 40], defaultStyle: { font: 'latin', fontSize: 10 }, content } as never).getBlob()
}

/** Open the PDF in a new tab so the browser's print dialog is one click away. */
export function openForPrint(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const w = window.open(url, '_blank')
  if (w) w.addEventListener('load', () => w.print())
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export const PAY_ERR: Record<string, string> = {
  FORBIDDEN: 'Only a company admin can do that.', MONTH_IN_FUTURE: 'You cannot run payroll for a future month.', RUN_FINALIZED: 'This month is already finalized.',
  NO_PAYSLIPS: 'Generate the payroll first.', ADVANCE_CHANGED: 'An advance changed while finalizing. Regenerate and try again.',
  DEDUCTION_EXCEEDS_PAY: 'Other deductions cannot exceed the pay.', INVALID_AMOUNT: 'Enter a valid amount.', INVALID_INSTALLMENT: 'The monthly deduction cannot be more than the advance.',
  INVALID_DATE: 'Enter a valid date.', INVALID_MODE: 'Choose how it was paid.', ALREADY_PAID: 'Already marked as paid.', RUN_NOT_FINALIZED: 'Finalize the month first.',
  EMPLOYEE_NOT_FOUND: 'Employee not found or inactive.', ALREADY_VOIDED: 'This advance is already voided.', NOTHING_TO_VOID: 'Nothing is left to void.', ADVANCE_NOT_FOUND: 'Advance not found.',
}
export const payError = (m: string) => { const k = Object.keys(PAY_ERR).find((c) => m.includes(c)); return k ? PAY_ERR[k] : m }

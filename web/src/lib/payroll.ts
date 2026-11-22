export interface Payslip {
  id: string; run_id: string; employee_id: string; month: string; pay_type: 'monthly' | 'daily'
  monthly_salary: number | null; daily_wage: number | null; working_days: number
  present_days: number; holiday_days: number; paid_leave_days: number; unpaid_leave_days: number; absent_days: number
  gross: number; bonus: number; other_deduction: number; skip_advance: boolean; advance_deduction: number; net: number
  adjustment_note: string | null; finalized: boolean; paid_on: string | null; payment_mode: string | null
  employees?: { full_name: string; employee_code: string } | null
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

export interface PdfInput { p: Payslip; companyName: string; template?: Template | null; bankLine?: string | null }
export async function payslipPdf({ p, companyName, template, bankLine }: PdfInput): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const accent = template?.accent ?? '#0f172a'
  const rgb: [number, number, number] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16)) as [number, number, number]
  doc.setTextColor(...rgb); doc.setFontSize(16); doc.text(template?.header_text?.trim() || companyName, 40, 48)
  doc.setTextColor(30); doc.setFontSize(11); doc.text(`Payslip for ${monthLabel(p.month)}`, 40, 68)
  doc.setFontSize(10)
  doc.text(`Employee: ${p.employees?.full_name ?? ''} (${p.employees?.employee_code ?? ''})`, 40, 88)
  let y = 104
  if (bankLine && template?.show_bank) { doc.text(bankLine, 40, y); y += 16 }
  if (template?.show_attendance ?? true) {
    autoTable(doc, {
      startY: y + 6, theme: 'grid', styles: { fontSize: 9 }, headStyles: { fillColor: rgb },
      head: [['Working days', 'Present', 'Holidays', 'Paid leave', 'Unpaid leave', 'Absent']],
      body: [[p.working_days, p.present_days, p.holiday_days, p.paid_leave_days, p.unpaid_leave_days, p.absent_days].map(String)],
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  }
  const l = payslipLines(p)
  autoTable(doc, {
    startY: y + 14, theme: 'grid', styles: { fontSize: 10 }, headStyles: { fillColor: rgb },
    head: [['Earnings', 'Amount']], body: l.earnings.map(([k, v]) => [k, rs(v)]), columnStyles: { 1: { halign: 'right' } },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  if (l.deductions.length) {
    autoTable(doc, {
      startY: y + 10, theme: 'grid', styles: { fontSize: 10 }, headStyles: { fillColor: rgb },
      head: [['Deductions', 'Amount']], body: l.deductions.map(([k, v]) => [k, rs(v)]), columnStyles: { 1: { halign: 'right' } },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  }
  doc.setFontSize(13); doc.setTextColor(...rgb); doc.text(`Net pay: ${rs(l.net)}`, 40, y + 34)
  doc.setFontSize(9); doc.setTextColor(80)
  if (p.paid_on) doc.text(`Paid on ${p.paid_on} (${p.payment_mode})`, 40, y + 52)
  if (template?.footer_text) doc.text(doc.splitTextToSize(template.footer_text, 515), 40, y + 76)
  doc.setTextColor(120); doc.text('Computer-generated payslip.', 40, 800)
  return doc.output('blob')
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
  EMPLOYEE_NOT_FOUND: 'Employee not found or inactive.',
}
export const payError = (m: string) => { const k = Object.keys(PAY_ERR).find((c) => m.includes(c)); return k ? PAY_ERR[k] : m }

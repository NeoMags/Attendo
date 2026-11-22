// EPFO ECR text and ESIC upload CSV builders. File layouts: ECR 11-field '#~#' record (confirmed on EPFO's site in an earlier research step);
// ESIC column headers are from memory and NOT verified against the current ESIC template - check before uploading.
export interface StatRow {
  employee_id: string; employee_code: string; full_name: string; uan: string | null; esi_ip_number: string | null; gross: number
  pf_applies: boolean; pf_ceiling: number; epf_wages: number; eps_wages: number; edli_wages: number; ee_epf: number; er_eps: number; er_epf: number; ncp_days: number
  esi_applies: boolean; esi_wages: number; esi_days: number; esi_employee: number; esi_employer: number; warnings: string[]
}
export interface StatSummary {
  pf: { members: number; epf_wages: number; eps_wages: number; edli_wages: number; ee_epf: number; er_eps: number; er_epf: number; edli: number; admin: number; total: number; filing: Filing | null }
  esi: { members: number; wages: number; employee: number; employer: number; total: number; filing: Filing | null }
}
export interface Filing { filed_on: string; reference: string | null; amount: number }

export const WARNING_TEXT: Record<string, string> = {
  MISSING_UAN: 'No UAN - left out of the ECR file', MISSING_ESI_IP: 'No ESI IP number - left out of the ESI file',
  CEILING_PRORATED: 'PF ceiling changed mid-month; day-weighted ceiling used (method unverified)', NCP_ROUNDED: 'Half-day no-pay rounded to a whole NCP day',
  ESI_ABOVE_CEILING: 'Above the ESI wage ceiling - not included', ESI_DAYS_ROUNDED: 'Half-day paid days rounded in the ESI file',
}

const clean = (s: string) => s.replace(/#~#|[\r\n]/g, ' ').trim()

export function ecrText(rows: StatRow[]): { text: string; included: number; skipped: string[] } {
  const skipped: string[] = []; const lines: string[] = []
  for (const r of rows) {
    if (!r.pf_applies) continue
    if (!r.uan) { skipped.push(r.employee_code); continue }
    lines.push([r.uan, clean(r.full_name).toUpperCase(), Math.round(r.gross), r.epf_wages, r.eps_wages, r.edli_wages, r.ee_epf, r.er_eps, r.er_epf, r.ncp_days, 0].join('#~#'))
  }
  return { text: lines.join('\n'), included: lines.length, skipped }
}

const csvCell = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
export const ESI_HEADER = ['IP Number', 'IP Name', 'No of Days for which wages paid/payable during the month', 'Total Monthly Wages', 'Reason Code for Zero workings days(numeric only; provide 0 for all other reasons)', 'Last Working Day']

export function esiCsv(rows: StatRow[]): { text: string; included: number; skipped: string[] } {
  const skipped: string[] = []; const lines: string[] = [ESI_HEADER.map(csvCell).join(',')]
  let included = 0
  for (const r of rows) {
    if (!r.esi_applies) continue
    if (!r.esi_ip_number || r.esi_days <= 0) { skipped.push(r.employee_code); continue }
    lines.push([r.esi_ip_number, r.full_name.trim(), r.esi_days, r.esi_wages, 0, ''].map(csvCell).join(',')); included++
  }
  return { text: lines.join('\n'), included, skipped }
}

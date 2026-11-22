export interface Scenario { regime: 'old' | 'new'; deductions: number; taxable: number; slab_tax: number; rebate: number; tax_after_rebate: number; cess: number; total: number }
export interface Projection {
  tax_year: number; as_of_month: string; months_left: number; regime: 'old' | 'new'; earned_before: number; monthly_pay_assumed: number; annual_gross: number
  selected: Scenario; new: Scenario; old: Scenario; prev_employer_tds: number; tds_deducted_here: number; monthly_tds: number; warnings: string[]
}
export interface Declaration {
  regime: 'old' | 'new'; sec_80c: number; sec_80ccd1b: number; sec_80d_self: number; sec_80d_parents: number; parents_senior: boolean
  hra_exemption: number; home_loan_interest: number; other_deductions: number; prev_employer_income: number; prev_employer_tds: number
}
export const EMPTY_DECL: Declaration = { regime: 'new', sec_80c: 0, sec_80ccd1b: 0, sec_80d_self: 0, sec_80d_parents: 0, parents_senior: false, hra_exemption: 0, home_loan_interest: 0, other_deductions: 0, prev_employer_income: 0, prev_employer_tds: 0 }

export const AMOUNT_FIELDS: { key: keyof Declaration; label: string; hint?: string; oldOnly: boolean }[] = [
  { key: 'sec_80c', label: 'Section 80C investments (₹/year)', hint: 'PPF, ELSS, life insurance, tuition fees... capped at ₹1,50,000 in the old regime', oldOnly: true },
  { key: 'sec_80ccd1b', label: 'NPS additional (80CCD(1B)) (₹/year)', hint: 'capped at ₹50,000', oldOnly: true },
  { key: 'sec_80d_self', label: 'Health insurance - self/family (80D) (₹/year)', hint: 'capped at ₹25,000 (assumes below 60)', oldOnly: true },
  { key: 'sec_80d_parents', label: 'Health insurance - parents (80D) (₹/year)', hint: 'capped at ₹25,000, or ₹50,000 if a parent is a senior citizen', oldOnly: true },
  { key: 'hra_exemption', label: 'HRA exemption (₹/year)', hint: 'worked out from rent receipts and salary structure; not calculated here', oldOnly: true },
  { key: 'home_loan_interest', label: 'Home-loan interest, self-occupied (₹/year)', hint: 'capped at ₹2,00,000', oldOnly: true },
  { key: 'other_deductions', label: 'Other deductions (₹/year)', hint: 'donations, education-loan interest, etc., as worked out by you', oldOnly: true },
  { key: 'prev_employer_income', label: 'Salary from a previous employer this year (₹)', oldOnly: false },
  { key: 'prev_employer_tds', label: 'TDS already deducted by the previous employer (₹)', oldOnly: false },
]

export const TAX_WARNING: Record<string, string> = {
  NO_DECLARATION: 'No declaration yet - new regime assumed', DAILY_ESTIMATE: 'Daily-wage pay estimated at 26 days a month',
  OLD_SLABS_UNVERIFIED: 'Old-regime slabs not re-checked for 2026-27', SURCHARGE_NOT_MODELLED: 'Income above ₹50 lakh: surcharge is not included',
}
export const TAX_ERR: Record<string, string> = {
  FORBIDDEN: 'You are not allowed to do that.', INVALID_REGIME: 'Choose old or new regime.', INVALID_AMOUNT: 'Amounts must be between 0 and 10,00,00,000.',
  INVALID_TAX_YEAR: 'That tax year is not available.', NO_PAY_INFO: 'Add salary details for this employee first.', NO_TAX_RULES: 'Tax rules are not loaded for this year.',
}
export const taxError = (m: string) => { const k = Object.keys(TAX_ERR).find((c) => m.includes(c)); return k ? TAX_ERR[k] : m }
/** Tax year is named by the calendar year it starts in (2026 = 1 Apr 2026 - 31 Mar 2027). */
export const taxYearOf = (d: Date) => (d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1)
export const taxYearLabel = (y: number) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`

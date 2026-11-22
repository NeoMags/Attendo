export type Lang = 'en' | 'hi' | 'kn'
export const LANGS: [Lang, string][] = [['en', 'English'], ['hi', 'हिन्दी'], ['kn', 'ಕನ್ನಡ']]
export const asLang = (v: string | null | undefined): Lang => (v === 'hi' || v === 'kn' ? v : 'en')

export interface Labels {
  payslipFor: string; employee: string; workingDays: string; present: string; holidays: string; paidLeave: string; unpaidLeave: string; absent: string
  earnings: string; deductions: string; amount: string; salaryDays: string; wagesDays: string; bonus: string; advance: string; other: string
  netPay: string; paidOn: string; by: string; pending: string; note: string; generated: string
  modes: Record<string, string>
}

export const LABELS: Record<Lang, Labels> = {
  en: {
    payslipFor: 'Payslip for', employee: 'Employee', workingDays: 'Working days', present: 'Present', holidays: 'Holidays', paidLeave: 'Paid leave', unpaidLeave: 'Unpaid leave', absent: 'Absent',
    earnings: 'Earnings', deductions: 'Deductions', amount: 'Amount', salaryDays: 'Salary for days paid', wagesDays: 'Wages for days paid', bonus: 'Bonus / other earnings', advance: 'Advance recovery', other: 'Other deductions',
    netPay: 'Net pay', paidOn: 'Paid on', by: 'by', pending: 'Payment pending', note: 'Note', generated: 'Computer-generated payslip.',
    modes: { bank: 'bank', cash: 'cash', upi: 'UPI', cheque: 'cheque', other: 'other' },
  },
  hi: {
    payslipFor: 'वेतन पर्ची –', employee: 'कर्मचारी', workingDays: 'कार्य दिवस', present: 'उपस्थित', holidays: 'छुट्टियाँ', paidLeave: 'सवेतन अवकाश', unpaidLeave: 'अवैतनिक अवकाश', absent: 'अनुपस्थित',
    earnings: 'आय', deductions: 'कटौतियाँ', amount: 'राशि', salaryDays: 'भुगतान योग्य दिनों का वेतन', wagesDays: 'भुगतान योग्य दिनों की मजदूरी', bonus: 'बोनस / अन्य आय', advance: 'अग्रिम वसूली', other: 'अन्य कटौतियाँ',
    netPay: 'शुद्ध वेतन', paidOn: 'भुगतान की तारीख', by: 'माध्यम', pending: 'भुगतान लंबित', note: 'टिप्पणी', generated: 'कंप्यूटर द्वारा निर्मित वेतन पर्ची।',
    modes: { bank: 'बैंक', cash: 'नकद', upi: 'यूपीआई', cheque: 'चेक', other: 'अन्य' },
  },
  kn: {
    payslipFor: 'ವೇತನ ಚೀಟಿ –', employee: 'ನೌಕರ', workingDays: 'ಕೆಲಸದ ದಿನಗಳು', present: 'ಹಾಜರು', holidays: 'ರಜೆಗಳು', paidLeave: 'ವೇತನ ಸಹಿತ ರಜೆ', unpaidLeave: 'ವೇತನ ರಹಿತ ರಜೆ', absent: 'ಗೈರು',
    earnings: 'ಆದಾಯ', deductions: 'ಕಡಿತಗಳು', amount: 'ಮೊತ್ತ', salaryDays: 'ಪಾವತಿ ದಿನಗಳ ವೇತನ', wagesDays: 'ಪಾವತಿ ದಿನಗಳ ಕೂಲಿ', bonus: 'ಬೋನಸ್ / ಇತರ ಆದಾಯ', advance: 'ಮುಂಗಡ ವಸೂಲಿ', other: 'ಇತರ ಕಡಿತಗಳು',
    netPay: 'ನಿವ್ವಳ ವೇತನ', paidOn: 'ಪಾವತಿ ದಿನಾಂಕ', by: 'ವಿಧಾನ', pending: 'ಪಾವತಿ ಬಾಕಿ', note: 'ಟಿಪ್ಪಣಿ', generated: 'ಕಂಪ್ಯೂಟರ್ ರಚಿತ ವೇತನ ಚೀಟಿ.',
    modes: { bank: 'ಬ್ಯಾಂಕ್', cash: 'ನಗದು', upi: 'ಯುಪಿಐ', cheque: 'ಚೆಕ್', other: 'ಇತರೆ' },
  },
}

const LOCALE: Record<Lang, string> = { en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN' }
/** "February 2026" in the payslip language; digits stay Latin so amounts and dates read the same in every language. */
export const monthIn = (m: string, lang: Lang) =>
  new Date(`${m}T00:00:00`).toLocaleDateString(`${LOCALE[lang]}-u-nu-latn`, { month: 'long', year: 'numeric' })

export type Script = 'latin' | 'hi' | 'kn'
const scriptOf = (ch: string): Script | null => {
  const c = ch.codePointAt(0)!
  if (c >= 0x900 && c <= 0x97f) return 'hi'
  if (c >= 0xc80 && c <= 0xcff) return 'kn'
  if (/[A-Za-z0-9₹]/.test(ch)) return 'latin'
  return null
}
/** Splits text into runs by script so each run uses a font that has its glyphs. Spaces/punctuation join the previous run. */
export function scriptRuns(s: string): { text: string; script: Script }[] {
  const out: { text: string; script: Script }[] = []
  for (const ch of s) {
    const sc = scriptOf(ch) ?? (out.length ? out[out.length - 1].script : 'latin')
    const last = out[out.length - 1]
    if (last && last.script === sc) last.text += ch
    else out.push({ text: ch, script: sc })
  }
  // a leading run of neutral characters followed by Indic text takes the Indic script
  if (out.length > 1 && out[0].script === 'latin' && !/[A-Za-z0-9]/.test(out[0].text)) { out[1].text = out[0].text + out[1].text; out.shift() }
  return out
}

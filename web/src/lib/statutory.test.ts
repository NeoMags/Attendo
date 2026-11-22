import { describe, expect, it } from 'vitest'
import { ecrText, esiCsv, type StatRow } from './statutory'

const base: StatRow = { employee_id: 'x', employee_code: 'E1', full_name: 'Asha Rao', uan: '100000000001', esi_ip_number: '1234567890', gross: 13000.4, pf_applies: true, pf_ceiling: 25000,
  epf_wages: 13000, eps_wages: 13000, edli_wages: 13000, ee_epf: 1560, er_eps: 1083, er_epf: 477, ncp_days: 6, esi_applies: true, esi_wages: 13000, esi_days: 20, esi_employee: 98, esi_employer: 423, warnings: [] }

describe('ecrText', () => {
  it('writes the 11-field #~# record', () => {
    const r = ecrText([base])
    expect(r.text).toBe('100000000001#~#ASHA RAO#~#13000#~#13000#~#13000#~#13000#~#1560#~#1083#~#477#~#6#~#0')
    expect(r.text.split('#~#')).toHaveLength(11)
  })
  it('skips members without a UAN and non-PF employees, and strips separators from names', () => {
    const r = ecrText([{ ...base, uan: null, employee_code: 'E2' }, { ...base, pf_applies: false }, { ...base, full_name: 'A#~#B\nC' }])
    expect(r.included).toBe(1); expect(r.skipped).toEqual(['E2']); expect(r.text).toContain('A B C')
  })
})
describe('esiCsv', () => {
  it('writes header and rows, quoting names with commas', () => {
    const r = esiCsv([{ ...base, full_name: 'Rao, Asha' }])
    const lines = r.text.split('\n')
    expect(lines).toHaveLength(2); expect(lines[1]).toBe('1234567890,"Rao, Asha",20,13000,0,')
  })
  it('skips rows without IP number or paid days, and non-ESI rows', () => {
    const r = esiCsv([{ ...base, esi_ip_number: null, employee_code: 'E3' }, { ...base, esi_days: 0, employee_code: 'E4' }, { ...base, esi_applies: false }])
    expect(r.included).toBe(0); expect(r.skipped).toEqual(['E3', 'E4'])
  })
})

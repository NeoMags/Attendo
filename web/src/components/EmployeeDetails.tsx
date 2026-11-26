import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { prepareUpload } from '@/lib/image'
import { aadhaarLast4, aadhaarStatus, docPath, formatAadhaar, isEsiIp, isIfsc, isUan, normalizePhone } from '@/lib/identity'
import { Button, ErrorNote, Field, Input, Modal, Select, Skeleton } from '@/components/ui'

const BUCKET = 'employee-docs'

interface Profile {
  photo_path: string | null; address: string | null; phone: string | null; alt_phone: string | null; referred_by: string | null
  date_of_birth: string | null; designation: string | null; emergency_name: string | null; emergency_phone: string | null; leave_request_limit_override: number | null
}
interface Pay {
  pay_type: 'monthly' | 'daily'; monthly_salary: number | null; daily_wage: number | null; pf_eligible: boolean; eps_eligible?: boolean; pf_uan: string | null
  esi_eligible: boolean; esi_ip_number: string | null; aadhaar_last4: string | null; aadhaar_path: string | null
  bank_name: string | null; bank_account: string | null; bank_ifsc: string | null
}

async function signed(path: string | null) {
  if (!path) return null
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300)
  return data?.signedUrl ?? null
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3"><legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</legend>{children}</fieldset>
}

export default function EmployeeDetails({ companyId, employeeId, name, onClose }: { companyId: string; employeeId: string; name: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [photo, setPhoto] = useState<File | null>(null)
  const [aadhaarFile, setAadhaarFile] = useState<File | null>(null)
  const [aadhaarNo, setAadhaarNo] = useState('')
  const [f, setF] = useState<Record<string, string> | null>(null)
  const [flags, setFlags] = useState({ pf: false, eps: true, esi: false, payType: 'monthly' as 'monthly' | 'daily' })
  const [err, setErr] = useState<string | null>(null)

  const load = useQuery({
    queryKey: ['emp-details', employeeId],
    queryFn: async () => {
      const [p, pay] = await Promise.all([
        supabase.from('employee_profiles').select('*').eq('employee_id', employeeId).maybeSingle(),
        supabase.from('employee_payroll_info').select('*').eq('employee_id', employeeId).maybeSingle(),
      ])
      if (p.error ?? pay.error) throw (p.error ?? pay.error)
      const prof = p.data as Profile | null, pi = pay.data as Pay | null
      setF({
        address: prof?.address ?? '', phone: prof?.phone ?? '', alt_phone: prof?.alt_phone ?? '', referred_by: prof?.referred_by ?? '', dob: prof?.date_of_birth ?? '',
        designation: prof?.designation ?? '', em_name: prof?.emergency_name ?? '', em_phone: prof?.emergency_phone ?? '',
        limit: prof?.leave_request_limit_override == null ? '' : String(prof.leave_request_limit_override),
        amount: String(pi?.pay_type === 'daily' ? pi.daily_wage ?? '' : pi?.monthly_salary ?? ''),
        uan: pi?.pf_uan ?? '', esi: pi?.esi_ip_number ?? '', bank: pi?.bank_name ?? '', acct: pi?.bank_account ?? '', ifsc: pi?.bank_ifsc ?? '',
      })
      setFlags({ pf: pi?.pf_eligible ?? false, eps: pi?.eps_eligible ?? true, esi: pi?.esi_eligible ?? false, payType: pi?.pay_type ?? 'monthly' })
      return { prof, pi, photoUrl: await signed(prof?.photo_path ?? null), aadhaarUrl: await signed(pi?.aadhaar_path ?? null) }
    },
  })

  const save = useMutation({
    mutationFn: async () => {
      const v = f!
      const phone = normalizePhone(v.phone), alt = v.alt_phone.trim() ? normalizePhone(v.alt_phone) : null, em = v.em_phone.trim() ? normalizePhone(v.em_phone) : null
      const amount = Number(v.amount)
      const noAadhaarYet = !load.data?.pi?.aadhaar_last4
      if (!phone) throw new Error('Enter a valid phone number.')
      if (v.alt_phone.trim() && !alt) throw new Error('Alternate phone is not valid.')
      if (v.em_phone.trim() && !em) throw new Error('Emergency phone is not valid.')
      if (!v.address.trim()) throw new Error('Address is required.')
      if (!v.amount.trim() || !Number.isFinite(amount) || amount < 0) throw new Error(`Enter the ${flags.payType === 'monthly' ? 'monthly salary' : 'daily wage'}.`)
      if (aadhaarNo.trim() && aadhaarStatus(aadhaarNo) === 'incomplete') throw new Error('Aadhaar number must be 12 digits.')
      if (noAadhaarYet && !aadhaarNo.trim()) throw new Error('Enter the Aadhaar number (only the last 4 digits are stored).')
      if (v.uan.trim() && !isUan(v.uan.trim())) throw new Error('UAN must be 12 digits.')
      if (v.esi.trim() && !isEsiIp(v.esi.trim())) throw new Error('ESI IP number must be 10 or 17 digits.')
      if (v.ifsc.trim() && !isIfsc(v.ifsc.trim().toUpperCase())) throw new Error('IFSC code is not valid.')
      if (v.acct.trim() && !/^[0-9]{6,20}$/.test(v.acct.trim())) throw new Error('Bank account number must be 6–20 digits.')
      if (v.limit.trim() && !(Number(v.limit) >= 0 && Number(v.limit) <= 31 && Number.isInteger(Number(v.limit)))) throw new Error('Leave request limit must be a whole number from 0 to 31.')

      let photoPath = load.data?.prof?.photo_path ?? null
      if (photo) {
        const { blob, mime } = await prepareUpload(photo)
        const path = docPath(companyId, employeeId, 'photo', mime)!
        const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: mime })
        if (error) throw new Error(`Photo upload failed: ${error.message}`)
        photoPath = path
      }
      let aPath = load.data?.pi?.aadhaar_path ?? null
      if (aadhaarFile) {
        const { blob, mime } = await prepareUpload(aadhaarFile)
        const path = docPath(companyId, employeeId, 'aadhaar', mime)!
        const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: mime })
        if (error) throw new Error(`Aadhaar upload failed: ${error.message}`)
        if (aPath && aPath !== path) await supabase.storage.from(BUCKET).remove([aPath])
        aPath = path
      }
      const p1 = await supabase.from('employee_profiles').upsert({
        employee_id: employeeId, company_id: companyId, photo_path: photoPath, address: v.address.trim(), phone, alt_phone: alt,
        referred_by: v.referred_by.trim() || null, date_of_birth: v.dob || null, designation: v.designation.trim() || null,
        emergency_name: v.em_name.trim() || null, emergency_phone: em, leave_request_limit_override: v.limit.trim() ? Number(v.limit) : null,
      }, { onConflict: 'employee_id' })
      if (p1.error) throw p1.error
      const p2 = await supabase.from('employee_payroll_info').upsert({
        employee_id: employeeId, company_id: companyId, pay_type: flags.payType,
        monthly_salary: flags.payType === 'monthly' ? amount : null, daily_wage: flags.payType === 'daily' ? amount : null,
        pf_eligible: flags.pf, eps_eligible: flags.eps, pf_uan: v.uan.trim() || null, esi_eligible: flags.esi, esi_ip_number: v.esi.trim() || null,
        aadhaar_last4: aadhaarNo.trim() ? aadhaarLast4(aadhaarNo) : load.data?.pi?.aadhaar_last4 ?? null, aadhaar_path: aPath,
        bank_name: v.bank.trim() || null, bank_account: v.acct.trim() || null, bank_ifsc: v.ifsc.trim().toUpperCase() || null,
      }, { onConflict: 'employee_id' })
      if (p2.error) throw p2.error
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['emp-details', employeeId] }); onClose() },
    onError: (e: Error) => setErr(e.message),
  })

  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f!, [k]: e.target.value })
  return (
    <Modal title={`Details · ${name}`} onClose={onClose}>
      {load.isLoading || !f ? <Skeleton /> : load.error ? <ErrorNote error={load.error} /> : (
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); setErr(null); save.mutate() }} className="max-h-[75vh] space-y-3 overflow-y-auto pr-1">
          <Section title="Photo">
            <div className="flex items-center gap-3">
              {(photo || load.data?.photoUrl) && <img alt="Employee" className="h-16 w-16 rounded-full object-cover" src={photo ? URL.createObjectURL(photo) : load.data!.photoUrl!} />}
              <Field label="Take or upload a photo" hint="On a phone this opens the camera. JPG/PNG/WebP, resized automatically.">
                <input type="file" accept="image/*" capture="user" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
              </Field>
            </div>
          </Section>
          <Section title="Contact">
            <Field label="Address"><Input value={f.address} maxLength={500} onChange={set('address')} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone" hint="10-digit mobile or +country code"><Input inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
              <Field label="Alternate phone"><Input inputMode="tel" value={f.alt_phone} onChange={set('alt_phone')} /></Field>
              <Field label="Referred by"><Input value={f.referred_by} maxLength={120} onChange={set('referred_by')} /></Field>
              <Field label="Date of birth"><Input type="date" value={f.dob} onChange={set('dob')} /></Field>
              <Field label="Designation"><Input value={f.designation} maxLength={120} onChange={set('designation')} /></Field>
              <Field label="Emergency contact"><Input value={f.em_name} maxLength={120} onChange={set('em_name')} /></Field>
              <Field label="Emergency phone"><Input inputMode="tel" value={f.em_phone} onChange={set('em_phone')} /></Field>
            </div>
          </Section>
          <Section title="Aadhaar">
            <Field label="Aadhaar number" hint={load.data?.pi?.aadhaar_last4 ? `On file: ending ${load.data.pi.aadhaar_last4}. Enter again only to replace. The full number is never stored.` : 'Only the last 4 digits are stored; the full number is not saved.'}>
              <Input inputMode="numeric" autoComplete="off" value={aadhaarNo} onChange={(e) => setAadhaarNo(formatAadhaar(e.target.value))} placeholder="XXXX XXXX XXXX" maxLength={14} />
              {{ empty: null,
                incomplete: <p className="mt-1 text-xs text-slate-500">{aadhaarNo.replace(/\D/g, '').length} of 12 digits</p>,
                ok: <p className="mt-1 text-xs text-green-700">12 digits, checksum OK</p>,
                unusual: <p className="mt-1 text-xs text-amber-700">12 digits, but the checksum does not match. Check for a typo. You can still save.</p>,
              }[aadhaarStatus(aadhaarNo)]}
            </Field>
            <Field label="Aadhaar card image" hint={load.data?.aadhaarUrl ? 'A file is on file. Choose another to replace it.' : 'Capture or upload (JPG/PNG/PDF, up to 2 MB).'}>
              <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setAadhaarFile(e.target.files?.[0] ?? null)} />
            </Field>
            {load.data?.aadhaarUrl && !aadhaarFile && <a className="text-xs underline" href={load.data.aadhaarUrl} target="_blank" rel="noreferrer">View current file (link expires in 5 minutes)</a>}
          </Section>
          <Section title="Pay">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pay type"><Select value={flags.payType} onChange={(e) => setFlags({ ...flags, payType: e.target.value as 'monthly' | 'daily' })}><option value="monthly">Monthly salary</option><option value="daily">Daily wage</option></Select></Field>
              <Field label={flags.payType === 'monthly' ? 'Monthly salary (₹)' : 'Daily wage (₹)'}><Input inputMode="decimal" value={f.amount} onChange={set('amount')} /></Field>
            </div>
          </Section>
          <Section title="PF and ESI">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={flags.pf} onChange={(e) => setFlags({ ...flags, pf: e.target.checked })} /> Eligible for PF</label>
            {flags.pf && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={flags.eps} onChange={(e) => setFlags({ ...flags, eps: e.target.checked })} /> EPS (pension) member <span className="text-xs text-slate-500">- untick if wages were above the PF ceiling at joining</span></label>}
            {flags.pf && <Field label="UAN (12 digits)"><Input inputMode="numeric" value={f.uan} onChange={set('uan')} /></Field>}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={flags.esi} onChange={(e) => setFlags({ ...flags, esi: e.target.checked })} /> Eligible for ESI</label>
            {flags.esi && <Field label="ESI IP number" hint="10 or 17 digits"><Input inputMode="numeric" value={f.esi} onChange={set('esi')} /></Field>}
          </Section>
          <Section title="Bank (for salary payment)">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bank name"><Input value={f.bank} maxLength={120} onChange={set('bank')} /></Field>
              <Field label="IFSC"><Input value={f.ifsc} maxLength={11} onChange={set('ifsc')} /></Field>
            </div>
            <Field label="Account number"><Input inputMode="numeric" autoComplete="off" value={f.acct} onChange={set('acct')} /></Field>
          </Section>
          <Section title="Leave">
            <Field label="Leave requests per month (this employee)" hint="Leave empty to use the company limit. 0 blocks new requests."><Input inputMode="numeric" value={f.limit} onChange={set('limit')} /></Field>
          </Section>
          {err && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
          <Button type="submit" disabled={save.isPending} className="w-full">{save.isPending ? 'Saving…' : 'Save details'}</Button>
        </form>
      )}
    </Modal>
  )
}

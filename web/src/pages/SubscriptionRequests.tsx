import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  approveRequest, fetchRequests, fmtDateTime, isPdf, loginMessage, receiptUrl, rejectRequest, relatedRequests,
  type ApprovalResult, type RequestStatus, type SubscriptionRequest,
} from '@/lib/subscriptions'
import { durationLabel, formatInr } from '@/lib/subscribe'
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Skeleton, Table, Td, Textarea } from '@/components/ui'

type Tab = RequestStatus | 'all'
const TABS: { id: Tab; label: string }[] = [
  { id: 'pending', label: 'Pending' }, { id: 'approved', label: 'Approved' }, { id: 'rejected', label: 'Rejected' }, { id: 'all', label: 'All' },
]
const TONE = { pending: 'warn', approved: 'good', rejected: 'bad' } as const

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

export default function SubscriptionRequests() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['sub-requests'], queryFn: fetchRequests, refetchInterval: 60_000 })
  const [tab, setTab] = useState<Tab>('pending')
  const [reviewing, setReviewing] = useState<SubscriptionRequest | null>(null)
  const [approval, setApproval] = useState<ApprovalResult | null>(null)

  const all = q.data ?? []
  const shown = tab === 'all' ? all : all.filter((r) => r.status === tab)
  const count = (s: Tab) => (s === 'all' ? all.length : all.filter((r) => r.status === s).length)

  return (
    <div>
      <PageHeader title="Subscription requests" description="Check the payment against your bank or UPI app, then approve to create the customer's login or reject with a reason." />
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Request status">
        {TABS.map((t) => (
          <button
            key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}
          >{t.label} ({count(t.id)})</button>
        ))}
      </div>
      <Card>
        {q.isLoading && <Skeleton />}
        <ErrorNote error={q.error} />
        {q.data && (
          <Table
            head={['Reference', 'Customer', 'Plan', 'UTR', 'Submitted', 'Status', '']}
            empty={shown.length ? undefined : tab === 'pending' ? 'No requests waiting for review.' : 'Nothing here yet.'}
          >
            {shown.map((r) => (
              <tr key={r.id} className="tr-hoverable">
                <Td className="font-mono text-[13px]">{r.reference}</Td>
                <Td>
                  <div className="font-medium">{r.company_name}</div>
                  <div className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{r.applicant_name} · {r.email}</div>
                </Td>
                <Td>
                  <div>{r.plan_name}{r.kind === 'renewal' && <span className="ml-1.5"><Badge tone="info">Renewal</Badge></span>}</div>
                  <div className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>{formatInr(r.amount_inr)}</div>
                </Td>
                <Td className="font-mono text-[13px]">{r.utr}</Td>
                <Td className="whitespace-nowrap text-[13px]">{fmtDateTime(r.created_at)}</Td>
                <Td><Badge tone={TONE[r.status]}>{r.status[0].toUpperCase() + r.status.slice(1)}</Badge></Td>
                <Td className="text-right"><Button size="sm" variant={r.status === 'pending' ? 'primary' : 'ghost'} onClick={() => setReviewing(r)}>{r.status === 'pending' ? 'Review' : 'View'}</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {reviewing && (
        <ReviewModal
          request={reviewing} all={all} onClose={() => setReviewing(null)}
          onDone={(result) => {
            setReviewing(null)
            qc.invalidateQueries({ queryKey: ['sub-requests'] })
            if (result) { setApproval(result); qc.invalidateQueries({ queryKey: ['companies'] }) }
          }}
        />
      )}
      {approval && <CredentialsModal result={approval} onClose={() => setApproval(null)} />}
    </div>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>{label}</dt>
      <dd className="mt-0.5 break-words text-[14px]" style={{ color: 'var(--color-text-primary)' }}>{children}</dd>
    </div>
  )
}

function ReviewModal({ request: r, all, onClose, onDone }: {
  request: SubscriptionRequest; all: SubscriptionRequest[]; onClose: () => void; onDone: (a: ApprovalResult | null) => void
}) {
  const pending = r.status === 'pending'
  const [code, setCode] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const receipt = useQuery({ queryKey: ['receipt', r.receipt_path], queryFn: () => receiptUrl(r.receipt_path), staleTime: 240_000 })
  const related = relatedRequests(r, all)
  const approve = useMutation({ mutationFn: () => approveRequest(r.id, code), onSuccess: (a) => onDone(a) })
  const reject = useMutation({ mutationFn: () => rejectRequest(r.id, reason), onSuccess: () => onDone(null) })
  const busy = approve.isPending || reject.isPending

  return (
    <Modal
      wide title={`${r.reference} · ${r.company_name}`}
      description={r.kind === 'renewal' ? 'Renewal for an existing company.' : 'New customer. Approving creates the company and the admin login.'}
      onClose={busy ? () => {} : onClose}
      footer={pending ? (
        rejecting ? (
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>Back</Button>
            <Button variant="danger" loading={reject.isPending} disabled={!reason.trim() || busy} onClick={() => reject.mutate()}>Reject request</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setRejecting(true)}>Reject…</Button>
            <Button loading={approve.isPending} disabled={busy} onClick={() => approve.mutate()}>{r.kind === 'renewal' ? 'Approve and extend' : 'Approve and create login'}</Button>
          </>
        )
      ) : (<Button variant="ghost" onClick={onClose}>Close</Button>)}
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Detail label="Plan">{r.plan_name}</Detail>
            <Detail label="Amount to verify"><strong>{formatInr(r.amount_inr)}</strong></Detail>
            <Detail label="Employees">Up to {r.max_employees.toLocaleString('en-IN')}</Detail>
            <Detail label="Duration">{durationLabel(r.duration_months)}</Detail>
            <Detail label="UTR"><span className="font-mono">{r.utr}</span></Detail>
            <Detail label="Submitted">{fmtDateTime(r.created_at)}</Detail>
            <Detail label="Applicant">{r.applicant_name}</Detail>
            <Detail label="Phone">{r.phone}</Detail>
            <div className="col-span-2"><Detail label={r.kind === 'new' ? 'Username (email)' : 'Email'}>{r.email}</Detail></div>
          </dl>

          {related.length > 0 && (
            <div className="rounded-lg border px-3 py-2.5 text-[13px]" style={{ borderColor: 'color-mix(in srgb, var(--color-warn) 40%, transparent)', background: 'color-mix(in srgb, var(--color-warn) 10%, transparent)' }}>
              <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>Also seen in other requests</div>
              <ul className="mt-1 space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                {related.map(({ request: o, why }) => (
                  <li key={o.id}><span className="font-mono">{o.reference}</span> ({o.status}): {why.join(', ')}</li>
                ))}
              </ul>
            </div>
          )}

          {r.status === 'rejected' && <p className="text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>Rejected: {r.reject_reason}</p>}
          {r.status === 'approved' && r.reviewed_at && <p className="text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>Approved on {fmtDateTime(r.reviewed_at)}.</p>}

          {pending && r.kind === 'new' && !rejecting && (
            <Field label="Company code (optional)" hint="Employees type this in the mobile app. Leave blank to derive it from the company name.">
              <Input value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} placeholder="e.g. rao-traders" disabled={busy} />
            </Field>
          )}
          {pending && rejecting && (
            <Field label="Reason for rejecting" hint="Kept on the request; up to 300 characters.">
              <Textarea value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Amount received was lower than the plan price" disabled={busy} />
            </Field>
          )}
          <ErrorNote error={approve.error ?? reject.error} />
        </div>

        <div>
          <div className="mb-1.5 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>Payment receipt</div>
          {receipt.isLoading && <Skeleton />}
          {receipt.isError && <ErrorNote error={receipt.error} />}
          {receipt.data && (isPdf(r.receipt_path)
            ? <a href={receipt.data} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">Open PDF receipt</a>
            : (
              <a href={receipt.data} target="_blank" rel="noopener noreferrer" title="Open full size">
                <img src={receipt.data} alt={`Payment receipt for ${r.reference}`} className="max-h-[26rem] w-full rounded-lg border object-contain" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-muted)' }} />
              </a>
            ))}
        </div>
      </div>
    </Modal>
  )
}

function CredentialsModal({ result: a, onClose }: { result: ApprovalResult; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null)
  const [everCopied, setEverCopied] = useState(false)
  const isNew = a.kind === 'new' && a.temporary_password
  const flash = async (what: string, text: string) => {
    if (await copyText(text)) { setCopied(what); setEverCopied(true); setTimeout(() => setCopied(null), 1800) }
  }
  const close = () => {
    if (isNew && !everCopied && !window.confirm('The temporary password will not be shown again. Close without copying it?')) return
    onClose()
  }
  return (
    <Modal
      title={isNew ? 'Login created' : 'Subscription extended'}
      description={`${a.company_name}${a.plan ? ' · ' + a.plan : ''}${a.expires_on ? ' · valid until ' + a.expires_on : ''}`}
      onClose={close}
      footer={<Button onClick={close}>Done</Button>}
    >
      {isNew ? (
        <div className="space-y-4">
          <div className="rounded-lg border px-4 py-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-muted)' }}>
            <div className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>Username</div>
            <div className="text-[15px] font-medium">{a.email}</div>
            <div className="mt-3 text-[12px]" style={{ color: 'var(--color-text-muted)' }}>Temporary password</div>
            <div className="select-all font-mono text-lg font-semibold tracking-wide">{a.temporary_password}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => flash('pw', a.temporary_password!)}>{copied === 'pw' ? 'Copied' : 'Copy password'}</Button>
            <Button size="sm" onClick={() => flash('msg', loginMessage(a, window.location.origin))}>{copied === 'msg' ? 'Copied' : 'Copy message for customer'}</Button>
          </div>
          <p className="text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
            This password is shown only now and is not stored anywhere you can read it back. Copy it and send it to the customer yourself.
            They set a new password at first sign-in.
          </p>
        </div>
      ) : (
        <p className="text-sm">The existing subscription for {a.company_name} was extended. The customer keeps signing in as before.</p>
      )}
    </Modal>
  )
}

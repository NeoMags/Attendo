import { useState } from 'react'
import { formatInr, qrUrl, upiLink, type PaymentInfo } from '@/lib/subscribe'
import { Button } from '@/components/ui'

export const canPayWith = (info: PaymentInfo): boolean => Boolean(info.upi_id || info.qr_path)

export function FieldError({ text }: { text: string }) {
  return <p role="alert" className="mt-1 text-[12px]" style={{ color: 'var(--color-bad)' }}>{text}</p>
}

/** UPI payment instructions: QR, payee, copyable UPI ID and a deep link for phones. Shared by the public form and Billing. */
export default function PaymentPanel({ amount, info }: { amount: number; info: PaymentInfo }) {
  const [copied, setCopied] = useState(false)
  const qr = qrUrl(info.qr_path)
  const link = upiLink(info, amount)

  async function copyUpi() {
    try { await navigator.clipboard.writeText(info.upi_id!); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* clipboard unavailable: the ID stays visible to copy by hand */ }
  }

  return (
    <section className="card p-5" aria-label="Pay by UPI">
      <h2 className="text-[15px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>Pay {formatInr(amount)} by UPI</h2>
      {!canPayWith(info) ? (
        <p className="mt-3 text-[14px]" style={{ color: 'var(--color-text-muted)' }}>Payment details are not set up yet. Please check back soon.</p>
      ) : (
        <>
          {qr && <img src={qr} alt={`UPI QR code${info.payee_name ? ' for ' + info.payee_name : ''}`} className="mx-auto mt-4 h-52 w-52 rounded-lg border object-contain p-2" style={{ borderColor: 'var(--color-border)', background: '#fff' }} />}
          {info.payee_name && (
            <div className="mt-4 text-[13px]" style={{ color: 'var(--color-text-muted)' }}>Payee<div className="text-[15px] font-medium" style={{ color: 'var(--color-text-primary)' }}>{info.payee_name}</div></div>
          )}
          {info.upi_id && (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-muted)' }}>
              <div className="min-w-0">
                <div className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>UPI ID</div>
                <div className="truncate font-mono text-[14px]" style={{ color: 'var(--color-text-primary)' }}>{info.upi_id}</div>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={copyUpi}>{copied ? 'Copied' : 'Copy'}</Button>
            </div>
          )}
          {link && <a href={link} className="btn btn-primary mt-3 w-full justify-center sm:hidden">Open UPI app</a>}
          <p className="mt-4 text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
            After paying, copy the UTR (transaction reference) from your UPI app and take a screenshot of the payment. Enter both on the right.
          </p>
        </>
      )}
    </section>
  )
}

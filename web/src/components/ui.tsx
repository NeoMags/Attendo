import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

const cx = (...a: Array<string | false | undefined>) => a.filter(Boolean).join(' ')

export function Button({ variant = 'primary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-amber-400 text-slate-900 shadow-sm hover:bg-amber-300',
        variant === 'ghost' && 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        className,
      )}
    />
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

const inputCls = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200'
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, p.className)} />

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

const ICONS: Record<string, string> = {
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  check: 'M20 6 9 17l-5-5',
  clock: 'M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0',
  battery: 'M16 7h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2M2 9a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM22 11v2',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  route: 'M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6M18 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M9 16h5a3 3 0 0 0 3-3v-2',
  userx: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 8l5 5M22 8l-5 5',
}
export type IconName = keyof typeof ICONS
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cx('h-5 w-5', className)}>
      <path d={ICONS[name]} />
    </svg>
  )
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
  const dim = size === 'lg' ? 'h-12 w-12 text-base' : size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs'
  return <span aria-hidden className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-slate-800', dim)} style={{ backgroundColor: `hsl(${hue} 70% 88%)` }}>{initials}</span>
}

/** Name with avatar; optional click to open the employee panel. */
export function PersonCell({ name, code, onClick }: { name: string; code?: string; onClick?: () => void }) {
  const inner = (
    <span className="inline-flex items-center gap-2">
      <Avatar name={name} size="sm" />
      <span>{name}{code ? <span className="text-slate-400"> ({code})</span> : null}</span>
    </span>
  )
  return onClick ? <button type="button" onClick={onClick} className="text-left hover:underline">{inner}</button> : inner
}

export function Stat({ label, value, tone, icon, hint }: { label: string; value: ReactNode; tone?: 'warn' | 'bad' | 'good'; icon?: IconName; hint?: string }) {
  const chip = tone === 'warn' ? 'bg-amber-100 text-amber-700' : tone === 'bad' ? 'bg-red-100 text-red-700' : tone === 'good' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
  return (
    <div className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
        <div className={cx('mt-1 text-2xl font-semibold', tone === 'warn' && 'text-amber-600', tone === 'bad' && 'text-red-600', tone === 'good' && 'text-emerald-600')}>{value}</div>
        {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
      </div>
      {icon && <span className={cx('rounded-lg p-2', chip)}><Icon name={icon} /></span>}
    </div>
  )
}

export function Badge({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'muted'; children: ReactNode }) {
  const t = { good: 'bg-emerald-100 text-emerald-800', warn: 'bg-amber-100 text-amber-800', bad: 'bg-red-100 text-red-800', muted: 'bg-slate-100 text-slate-600' }[tone]
  return <span className={cx('inline-block rounded-full px-2 py-0.5 text-xs font-medium', t)}>{children}</span>
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
          <tr>{head.map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {empty && <p className="px-2 py-6 text-center text-sm text-slate-500">{empty}</p>}
    </div>
  )
}
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cx('px-2 py-2', className)}>{children}</td>

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-900">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  const msg = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : 'Something went wrong'
  return <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</p>
}

export const Spinner = () => (
  <div role="status" aria-label="Loading" className="space-y-3 py-6">
    {[70, 100, 85].map((w) => <div key={w} className="h-4 animate-pulse rounded bg-slate-200" style={{ width: `${w}%` }} />)}
  </div>
)

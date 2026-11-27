import { useEffect, useId, useRef } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

const cx = (...a: Array<string | false | undefined>) => a.filter(Boolean).join(' ')

export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-8 w-8' : 'h-5 w-5'
  return (
    <svg aria-hidden className={cx('animate-spin', dim)} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
  )
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  loading?: boolean
}) {
  return (
    <button
      {...p}
      disabled={disabled || loading}
      className={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  )
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="field-label mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="field-hint mt-1.5 block">{hint}</span>}
    </label>
  )
}

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx('input', p.className)} />
}

export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cx('input', p.className)} />
}

export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx('input', p.className)} />
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-sub">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({
  title,
  children,
  actions,
  className,
}: {
  title?: string
  children: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <section className={cx('card p-5', className)}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {title}
          </h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

const ICONS: Record<string, string> = {
  users:          'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  check:          'M20 6 9 17l-5-5',
  clock:          'M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20',
  alert:          'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0',
  battery:        'M16 7h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2M2 9a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM22 11v2',
  calendar:       'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2',
  bell:           'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  pin:            'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  route:          'M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6M18 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M9 16h5a3 3 0 0 0 3-3v-2',
  userx:          'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 8l5 5M22 8l-5 5',
  x:              'M18 6 6 18M6 6l12 12',
  home:           'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10',
  'map-pin':      'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  'calendar-clock':'M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7.5M16 2v4M8 2v4M3 10h8M17.5 17.5 16 16.3V14M22 16a6 6 0 1 1-12 0 6 6 0 0 1 12 0',
  'bell-ring':    'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0M22 2 16 8M2 2l6 6',
  smartphone:     'M17 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM12 18h.01',
  'bar-chart-2':  'M18 20V10M12 20V4M6 20v-6',
  'check-square': 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  umbrella:       'M23 12a11.05 11.05 0 0 0-22 0zm-5 7a3 3 0 0 1-6 0v-7',
  banknote:       'M2 9h20v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM2 9V7a2 2 0 0 1 2-2h16a2 2 0 0 0 2 2v2M7 15h.01M11 15h2',
  'file-text':    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  'git-branch':   'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6M18 9a9 9 0 0 1-9 9',
  hexagon:        'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z',
  'settings-2':   'M20 7h-9M14 17H5M17 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6M7 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  'building-2':   'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18zM6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4',
  menu:           'M4 6h16M4 12h16M4 18h16',
  circle:         'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
  'trending-up':  'M22 7l-8.5 8.5-5-5L2 17',
  'trending-down':'M22 17l-8.5-8.5-5 5L2 7',
}
export type IconName = keyof typeof ICONS

export function Icon({
  name,
  size = 20,
  className,
  style,
}: {
  name: string
  size?: number
  className?: string
  style?: React.CSSProperties
}) {
  const d = ICONS[name] ?? ICONS['circle']
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      className={className}
      style={style}
    >
      <path d={d} />
    </svg>
  )
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
  const dim =
    size === 'lg' ? 'h-12 w-12 text-base' : size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs'
  return (
    <span
      aria-hidden
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', dim)}
      style={{ backgroundColor: `hsl(${hue} 70% 88%)`, color: '#0f172a' }}
    >
      {initials}
    </span>
  )
}

export function PersonCell({
  name,
  code,
  onClick,
}: {
  name: string
  code?: string
  onClick?: () => void
}) {
  const inner = (
    <span className="inline-flex items-center gap-2">
      <Avatar name={name} size="sm" />
      <span style={{ color: 'var(--color-text-primary)' }}>
        {name}
        {code ? <span style={{ color: 'var(--color-text-muted)' }}> ({code})</span> : null}
      </span>
    </span>
  )
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="text-left hover:underline"
      style={{ color: 'var(--color-text-primary)' }}
    >
      {inner}
    </button>
  ) : (
    inner
  )
}

const STAT_TONES = {
  warn: { chip: { background: 'color-mix(in srgb, var(--color-warn) 15%, transparent)', color: 'var(--color-warn)' }, value: 'var(--color-warn)' },
  bad:  { chip: { background: 'color-mix(in srgb, var(--color-bad)  15%, transparent)', color: 'var(--color-bad)'  }, value: 'var(--color-bad)'  },
  good: { chip: { background: 'color-mix(in srgb, var(--color-good) 15%, transparent)', color: 'var(--color-good)' }, value: 'var(--color-good)' },
} as const

export function Stat({
  label,
  value,
  tone,
  icon,
  hint,
}: {
  label: string
  value: ReactNode
  tone?: 'warn' | 'bad' | 'good'
  icon?: string
  hint?: string
}) {
  const t = tone ? STAT_TONES[tone] : null
  return (
    <div
      className="card flex items-start justify-between gap-3 p-5"
    >
      <div className="min-w-0">
        <div
          className="text-[13px] font-medium"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {label}
        </div>
        <div
          className="mt-2 font-semibold leading-none tracking-tight"
          style={{ color: t ? t.value : 'var(--color-text-primary)', fontFamily: 'var(--font-display)', fontSize: '1.875rem' }}
        >
          {value}
        </div>
        {hint && (
          <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {hint}
          </div>
        )}
      </div>
      {icon && (
        <span className="shrink-0 rounded-lg p-2" style={t ? t.chip : { background: 'var(--color-bg-muted)', color: 'var(--color-text-secondary)' }}>
          <Icon name={icon} size={18} />
        </span>
      )}
    </div>
  )
}

const BADGE_STYLES = {
  good:    { background: 'color-mix(in srgb, var(--color-good) 15%, transparent)', color: 'var(--color-good)'      },
  warn:    { background: 'color-mix(in srgb, var(--color-warn) 15%, transparent)', color: 'var(--color-warn)'      },
  bad:     { background: 'color-mix(in srgb, var(--color-bad)  15%, transparent)', color: 'var(--color-bad)'       },
  muted:   { background: 'var(--color-bg-muted)',                                   color: 'var(--color-text-muted)'},
  info:    { background: 'color-mix(in srgb, var(--color-info)  15%, transparent)', color: 'var(--color-info)'     },
  neutral: { background: 'var(--color-bg-muted)',                                   color: 'var(--color-text-secondary)' },
} as const

export function Badge({
  tone,
  children,
}: {
  tone: keyof typeof BADGE_STYLES
  children: ReactNode
}) {
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-xs font-medium leading-5"
      style={BADGE_STYLES[tone] ?? BADGE_STYLES.muted}
    >
      {children}
    </span>
  )
}

export function Table({
  head,
  children,
  empty,
}: {
  head: string[]
  children: ReactNode
  empty?: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead
          style={{
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-bg-muted)',
          }}
        >
          <tr>
            {head.map((h) => (
              <th
                key={h}
                className="px-3 py-2.5 text-[13px] font-semibold"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty && (
        <p className="px-3 py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {empty}
        </p>
      )}
    </div>
  )
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td
      className={cx('px-3 py-2.5', className)}
      style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
    >
      {children}
    </td>
  )
}

export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const first = panel.current?.querySelector<HTMLElement>('input, select, textarea')
    first?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      prev?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div ref={panel} className="modal-panel" style={{ maxWidth: wide ? '48rem' : '34rem' }}>
        <div className="modal-head">
          <div>
            <h2 id={titleId} className="text-lg font-semibold leading-snug">{title}</h2>
            {description && <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 -mt-1 rounded-lg p-1.5 transition-colors hover:bg-[var(--color-bg-muted)]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error && 'message' in error
      ? String((error as { message: unknown }).message)
      : 'Something went wrong'
  return (
    <p
      role="alert"
      className="rounded-lg px-3 py-2 text-sm"
      style={{
        background: 'color-mix(in srgb, var(--color-bad) 12%, transparent)',
        color: 'var(--color-bad)',
        border: '1px solid color-mix(in srgb, var(--color-bad) 25%, transparent)',
      }}
    >
      {msg}
    </p>
  )
}

export const Skeleton = () => (
  <div role="status" aria-label="Loading" className="space-y-3 py-6">
    {[70, 100, 85].map((w) => (
      <div
        key={w}
        className="h-4 animate-pulse rounded-lg"
        style={{ width: `${w}%`, background: 'var(--color-bg-muted)' }}
      />
    ))}
  </div>
)

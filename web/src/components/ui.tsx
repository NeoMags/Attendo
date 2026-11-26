import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

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
  loading,
  className,
  children,
  disabled,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger'
  loading?: boolean
}) {
  return (
    <button
      {...p}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'shadow-sm',
        variant === 'ghost' && 'border',
        variant === 'danger' && 'shadow-sm',
        className,
      )}
      style={{
        ...(variant === 'primary'
          ? { background: 'var(--color-accent)', color: '#0f172a' }
          : variant === 'ghost'
          ? { background: 'var(--color-bg-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }
          : variant === 'danger'
          ? { background: 'var(--color-bad)', color: '#fff' }
          : {}),
        ...(p.style ?? {}),
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLButtonElement
        if (!el.disabled) {
          if (variant === 'primary') el.style.opacity = '0.88'
          if (variant === 'ghost') el.style.background = 'var(--color-bg-muted)'
          if (variant === 'danger') el.style.opacity = '0.88'
        }
        p.onMouseEnter?.(e)
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement
        if (variant === 'primary') el.style.opacity = ''
        if (variant === 'ghost') el.style.background = 'var(--color-bg-surface)'
        if (variant === 'danger') el.style.opacity = ''
        p.onMouseLeave?.(e)
      }}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium" style={{ color: 'var(--color-text-primary)' }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {hint}
        </span>
      )}
    </label>
  )
}

const inputStyle = {
  background: 'var(--color-bg-surface)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-primary)',
  borderRadius: 'var(--radius-md)',
  fontSize: '0.875rem',
  padding: '0.375rem 0.625rem',
  width: '100%',
  outline: 'none',
  transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
} as const

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={cx('block', p.className)}
      style={{ ...inputStyle, ...p.style }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-accent)'
        e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--color-accent) 20%, transparent)'
        p.onFocus?.(e)
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.boxShadow = ''
        p.onBlur?.(e)
      }}
    />
  )
}

export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={cx('block', p.className)}
      style={{ ...inputStyle, ...p.style }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-accent)'
        e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--color-accent) 20%, transparent)'
        p.onFocus?.(e)
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.boxShadow = ''
        p.onBlur?.(e)
      }}
    />
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
    <section
      className={cx('rounded-xl p-5', className)}
      style={{
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
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
      className="flex items-start justify-between gap-3 rounded-xl p-5"
      style={{
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div className="min-w-0">
        <div
          className="text-xs font-medium uppercase tracking-wide"
          style={{ color: 'var(--color-text-muted)', letterSpacing: '0.07em' }}
        >
          {label}
        </div>
        <div
          className="mt-1.5 text-2xl font-bold leading-none"
          style={{ color: t ? t.value : 'var(--color-text-primary)' }}
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
                className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide"
                style={{ color: 'var(--color-text-muted)' }}
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
  onClose,
  children,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`w-full ${wide ? 'max-w-3xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto rounded-xl p-6`}
        style={{
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-xl)',
        }}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-muted)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        {children}
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

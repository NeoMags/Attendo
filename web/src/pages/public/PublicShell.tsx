import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BrandMark } from '@/components/Layout'

/** Frame for pages visible without signing in (pricing, subscribe). */
export default function PublicShell({ children, width = 'max-w-5xl' }: { children: ReactNode; width?: string }) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--color-bg-base)' }}>
      <header className="border-b" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-surface)' }}>
        <div className={`mx-auto flex h-14 items-center justify-between px-4 ${width}`}>
          <Link to="/plans" className="flex items-center gap-2.5">
            <BrandMark size={28} />
            <span className="text-[18px] font-semibold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>Attendo</span>
          </Link>
          <Link to="/login" className="btn btn-ghost btn-sm">Sign in</Link>
        </div>
      </header>
      <main className={`mx-auto px-4 py-10 ${width}`}>{children}</main>
    </div>
  )
}

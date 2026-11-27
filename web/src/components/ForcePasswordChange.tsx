import { useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { newPasswordProblem } from '@/lib/subscription'
import { BrandMark } from '@/components/Layout'
import { Button, ErrorNote, Field, Input } from '@/components/ui'

/** Shown instead of the dashboard while the account still has its temporary password. */
export default function ForcePasswordChange() {
  const { signOut, session } = useAuth()
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const p = newPasswordProblem(pw, confirm)
    setProblem(p)
    if (p) return
    setBusy(true); setError(null)
    const { error: err } = await supabase.auth.updateUser({ password: pw, data: { must_change_password: false } })
    if (err) { setBusy(false); setError(err); return }
    await supabase.auth.refreshSession() // pulls the cleared flag into the session; the dashboard then renders
    setBusy(false)
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4" style={{ background: 'var(--color-bg-base)' }}>
      <form onSubmit={submit} noValidate className="card w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center gap-2.5"><BrandMark /><span className="text-[19px] font-semibold" style={{ fontFamily: 'var(--font-display)' }}>Attendo</span></div>
        <div>
          <h1 className="text-xl font-semibold" style={{ fontFamily: 'var(--font-display)' }}>Set your password</h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--color-text-muted)' }}>
            You signed in with a temporary password{session?.user.email ? ` as ${session.user.email}` : ''}. Choose your own to continue.
          </p>
        </div>
        <Field label="New password" hint="8 to 72 characters with letters and digits.">
          <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-invalid={!!problem} />
        </Field>
        <Field label="Confirm new password">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {problem && <p role="alert" className="text-[13px]" style={{ color: 'var(--color-bad)' }}>{problem}</p>}
        <ErrorNote error={error} />
        <Button type="submit" disabled={busy} className="w-full">{busy ? 'Saving…' : 'Save password and continue'}</Button>
        <Button type="button" variant="ghost" className="w-full" onClick={signOut}>Sign out</Button>
      </form>
    </main>
  )
}

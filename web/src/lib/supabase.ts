import { createClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'

// Publishable (anon) key only. All access control is enforced by Postgres RLS and the Edge Functions.
export const supabase = createClient(env.supabaseUrl ?? 'http://localhost', env.supabaseAnonKey ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true },
})

/** Call an admin Edge Function and turn its { error, message } body into a readable Error. */
export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body: body as Record<string, unknown> })
  if (!error) return data as T
  let code = 'REQUEST_FAILED'
  let message = error.message
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const b = (await ctx.json()) as { error?: string; message?: string }
      code = b.error ?? code
      message = b.message ?? b.error ?? message
    } catch {
      /* non-JSON body */
    }
  }
  throw new ApiError(code, friendlyError(code, message))
}

export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const FRIENDLY: Record<string, string> = {
  UNAUTHENTICATED: 'Your session expired. Please sign in again.',
  FORBIDDEN: 'You do not have permission to do this.',
  WEAK_PASSWORD: 'Password must be 8–72 characters with letters and digits.',
  INVALID_EMPLOYEE_CODE: 'Employee ID may only use letters, digits, dot, dash and underscore (max 32).',
  INVALID_NAME: 'Please enter a name.',
  INVALID_EMAIL: 'Please enter a valid email address.',
  COMPANY_REQUIRED: 'Select a company first.',
  COMPANY_NOT_FOUND: 'Company not found.',
  EMPLOYEE_CREATE_FAILED: 'Could not create the employee. The Employee ID may already exist.',
  AUTH_USER_CREATE_FAILED: 'Could not create the login. It may already exist.',
  NOT_FOUND: 'Not found.',
}

export function friendlyError(code: string, fallback: string): string {
  return FRIENDLY[code] ?? fallback
}

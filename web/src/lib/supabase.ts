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
  NOT_PENDING: 'This request was already reviewed.',
  REQUEST_NOT_FOUND: 'Request not found.',
  COMPANY_CODE_TAKEN: 'That company code is already taken. Enter a different one.',
  INVALID_COMPANY_CODE: 'Company code: 2-32 lowercase letters, digits, dash or underscore.',
  EMAIL_ALREADY_REGISTERED: 'A login with this email already exists. Remove or rename it before approving.',
  APPROVE_FAILED: 'Could not approve the request. Nothing was created; try again.',
  PLAN_NOT_AVAILABLE: 'That plan is no longer available. Pick another plan.',
  INVALID_COMPANY_NAME: 'Please enter your company name.',
  INVALID_PHONE: 'Enter a phone number with 10 to 15 digits.',
  INVALID_UTR: 'Enter the UTR from your payment, 12 to 22 letters or digits.',
  INVALID_RECEIPT: 'The receipt could not be accepted. Attach it again.',
  UTR_ALREADY_USED: 'This UTR has already been submitted. Check the number, or contact support if you believe this is a mistake.',
  REQUEST_ALREADY_PENDING: 'A request for this email is already waiting for review. You will be contacted once it is verified.',
  RECEIPT_REQUIRED: 'Attach a screenshot or PDF of your payment.',
  RECEIPT_TOO_LARGE: 'The receipt must be 3 MB or smaller.',
  RECEIPT_TYPE: 'The receipt must be a JPG, PNG, WebP or PDF file.',
  TOO_MANY_ATTEMPTS: 'Too many requests from this network. Try again in an hour.',
}

export function friendlyError(code: string, fallback: string): string {
  return FRIENDLY[code] ?? fallback
}

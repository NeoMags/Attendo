export type TaskStatus = 'todo' | 'in_progress' | 'submitted' | 'rework' | 'approved' | 'cancelled'
export interface TaskRow {
  id: string; parent_id: string | null; title: string; description: string | null; assignee_id: string | null
  priority: 'low' | 'normal' | 'high'; due_date: string | null; status: TaskStatus
  submit_note: string | null; review_note: string | null; submitted_at: string | null
  employees: { full_name: string; employee_code: string } | null
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do', in_progress: 'In progress', submitted: 'Awaiting approval', rework: 'Sent back', approved: 'Approved', cancelled: 'Cancelled',
}
export const STATUS_TONE: Record<TaskStatus, 'good' | 'warn' | 'bad' | 'muted'> = {
  todo: 'muted', in_progress: 'warn', submitted: 'warn', rework: 'bad', approved: 'good', cancelled: 'muted',
}
export const isOpen = (s: TaskStatus) => s !== 'approved' && s !== 'cancelled'
/** Overdue = still open and the due date (company-local YYYY-MM-DD) is before today. */
export const isOverdue = (t: Pick<TaskRow, 'due_date' | 'status'>, today: string) => !!t.due_date && isOpen(t.status) && t.due_date < today

export interface TaskNode extends TaskRow { subs: TaskRow[] }
/** Group a flat list into parents with their subtasks. A subtask whose parent is not in the list is shown as its own row. */
export function groupTasks(rows: TaskRow[]): TaskNode[] {
  const ids = new Set(rows.map((r) => r.id))
  const subs = new Map<string, TaskRow[]>()
  for (const r of rows) if (r.parent_id && ids.has(r.parent_id)) subs.set(r.parent_id, [...(subs.get(r.parent_id) ?? []), r])
  return rows.filter((r) => !r.parent_id || !ids.has(r.parent_id)).map((r) => ({ ...r, subs: subs.get(r.id) ?? [] }))
}
/** "2 of 3" style progress over non-cancelled subtasks. */
export function subProgress(subs: TaskRow[]): { done: number; total: number } {
  const live = subs.filter((s) => s.status !== 'cancelled')
  return { done: live.filter((s) => s.status === 'approved').length, total: live.length }
}

export const TASK_ERR: Record<string, string> = {
  FORBIDDEN: 'You cannot do that with this task.', ASSIGNEE_NOT_ALLOWED: 'Managers can assign tasks only to their own team.',
  ASSIGNEE_NOT_FOUND: 'That employee was not found or is inactive.', INVALID_TITLE: 'Enter a title (up to 200 characters).',
  SUBTASK_DEPTH: 'Subtasks cannot have their own subtasks.', INVALID_STATE: 'The task has already moved on. Refresh the list.',
  SUBTASKS_OPEN: 'Finish and approve the subtasks first.', NOTE_REQUIRED: 'Enter a reason (at least 3 characters) when sending work back.',
  SELF_REVIEW_NOT_ALLOWED: 'You cannot approve your own task.', TASK_NOT_FOUND: 'Task not found.',
}
export const taskError = (m: string) => { const k = Object.keys(TASK_ERR).find((c) => m.includes(c)); return k ? TASK_ERR[k] : m }

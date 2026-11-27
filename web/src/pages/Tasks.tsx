import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select, Skeleton } from '@/components/ui'
import { STATUS_LABEL, STATUS_TONE, groupTasks, isOverdue, subProgress, taskError, type TaskRow, type TaskStatus } from '@/lib/tasks'

interface Emp { id: string; full_name: string; employee_code: string }
const COLS = 'id, parent_id, title, description, assignee_id, priority, due_date, status, submit_note, review_note, submitted_at, employees(full_name, employee_code)'
const todayStr = () => new Date().toLocaleDateString('en-CA')

interface Draft { title: string; description: string; assignee: string; priority: 'low' | 'normal' | 'high'; due: string }
const emptyDraft: Draft = { title: '', description: '', assignee: '', priority: 'normal', due: '' }

function TaskForm({ companyId, emps, parent, edit, onClose }: { companyId: string; emps: Emp[]; parent?: TaskRow; edit?: TaskRow; onClose: () => void }) {
  const qc = useQueryClient()
  const [d, setD] = useState<Draft>(edit ? { title: edit.title, description: edit.description ?? '', assignee: edit.assignee_id ?? '', priority: edit.priority, due: edit.due_date ?? '' } : emptyDraft)
  const [err, setErr] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: async () => {
      if (!d.title.trim()) throw new Error('Enter a title.')
      if (!edit && !d.assignee) throw new Error('Choose who this is assigned to.')
      const r = edit
        ? await supabase.rpc('update_task', { p_id: edit.id, p_title: d.title, p_description: d.description, p_assignee: d.assignee || null, p_priority: d.priority, p_due: d.due || null, p_clear_due: !d.due })
        : await supabase.rpc('create_task', { p_company: companyId, p_title: d.title, p_description: d.description || null, p_assignee: d.assignee, p_priority: d.priority, p_due: d.due || null, p_parent: parent?.id ?? null })
      if (r.error) throw new Error(taskError(r.error.message))
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); onClose() },
    onError: (e: Error) => setErr(e.message),
  })
  return (
    <Modal title={edit ? 'Edit task' : parent ? `Add subtask to “${parent.title}”` : 'New task'} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setErr(null); save.mutate() }} className="space-y-3">
        <Field label="Title"><Input value={d.title} maxLength={200} onChange={(e) => setD({ ...d, title: e.target.value })} autoFocus /></Field>
        <Field label="Details (optional)"><textarea className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" rows={3} maxLength={2000} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field>
        <Field label="Assign to">
          <Select value={d.assignee} onChange={(e) => setD({ ...d, assignee: e.target.value })}>
            <option value="">Choose employee…</option>
            {emps.map((m) => <option key={m.id} value={m.id}>{m.full_name} ({m.employee_code})</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Priority"><Select value={d.priority} onChange={(e) => setD({ ...d, priority: e.target.value as Draft['priority'] })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></Select></Field>
          <Field label="Due date"><Input type="date" value={d.due} onChange={(e) => setD({ ...d, due: e.target.value })} /></Field>
        </div>
        {err && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <Button type="submit" disabled={save.isPending} className="w-full">{save.isPending ? 'Saving…' : 'Save'}</Button>
      </form>
    </Modal>
  )
}

function TaskLine({ t, today, indent, onAction, onEdit, onAddSub, busy }: {
  t: TaskRow; today: string; indent?: boolean; busy: boolean
  onAction: (a: 'approve' | 'reject' | 'cancel', t: TaskRow) => void; onEdit: (t: TaskRow) => void; onAddSub?: (t: TaskRow) => void
}) {
  const over = isOverdue(t, today)
  return (
    <div className={`flex flex-wrap items-start justify-between gap-2 py-2 ${indent ? 'pl-6' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{t.title}</span>
          <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
          {t.priority === 'high' && <Badge tone="bad">High</Badge>}
          {over && <Badge tone="bad">Overdue</Badge>}
        </div>
        <div className="text-xs text-slate-500">
          {t.employees ? `${t.employees.full_name} (${t.employees.employee_code})` : 'Unassigned'}{t.due_date ? ` · due ${t.due_date}` : ''}
        </div>
        {t.description && <div className="text-xs text-slate-600">{t.description}</div>}
        {t.submit_note && t.status === 'submitted' && <div className="text-xs text-slate-600">Employee note: “{t.submit_note}”</div>}
        {t.review_note && t.status === 'rework' && <div className="text-xs text-red-700">Sent back: “{t.review_note}”</div>}
      </div>
      <div className="flex flex-wrap gap-1">
        {t.status === 'submitted' && <>
          <Button disabled={busy} onClick={() => onAction('approve', t)}>Approve</Button>
          <Button variant="ghost" disabled={busy} onClick={() => onAction('reject', t)}>Send back</Button>
        </>}
        {t.status !== 'approved' && t.status !== 'cancelled' && <>
          {onAddSub && <Button variant="ghost" onClick={() => onAddSub(t)}>+ Subtask</Button>}
          <Button variant="ghost" onClick={() => onEdit(t)}>Edit</Button>
          <Button variant="ghost" disabled={busy} onClick={() => onAction('cancel', t)}>Cancel</Button>
        </>}
      </div>
    </div>
  )
}

export default function Tasks() {
  const { companyId } = useAuth()
  const qc = useQueryClient()
  const [status, setStatus] = useState<'all' | 'review' | 'open' | TaskStatus>('open')
  const [assignee, setAssignee] = useState('')
  const [form, setForm] = useState<null | { parent?: TaskRow; edit?: TaskRow }>(null)
  const [rejecting, setRejecting] = useState<TaskRow | null>(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const today = todayStr()

  const emps = useQuery({
    queryKey: ['task-emps', companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id, full_name, employee_code').eq('company_id', companyId!).eq('is_active', true).order('full_name')
      if (error) throw error
      return data as Emp[]
    },
  })
  const q = useQuery({
    queryKey: ['tasks', companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('tasks').select(COLS).eq('company_id', companyId!).order('created_at', { ascending: false }).limit(500)
      if (error) throw error
      return data as unknown as TaskRow[]
    },
  })
  const act = useMutation({
    mutationFn: async (a: { kind: 'approve' | 'reject' | 'cancel'; t: TaskRow; note?: string }) => {
      const r = a.kind === 'cancel' ? await supabase.rpc('cancel_task', { p_id: a.t.id })
        : await supabase.rpc('review_task', { p_id: a.t.id, p_approve: a.kind === 'approve', p_note: a.note ?? null })
      if (r.error) throw new Error(taskError(r.error.message))
    },
    onSuccess: () => { setRejecting(null); setNote(''); setErr(null); qc.invalidateQueries({ queryKey: ['tasks'] }) },
    onError: (e: Error) => setErr(e.message),
  })
  const onAction = (kind: 'approve' | 'reject' | 'cancel', t: TaskRow) => {
    setErr(null)
    if (kind === 'reject') { setRejecting(t); setNote(''); return }
    if (kind === 'cancel' && !window.confirm(`Cancel “${t.title}”${t.parent_id ? '' : ' and its open subtasks'}?`)) return
    act.mutate({ kind, t })
  }

  if (!companyId) return <p className="text-sm text-slate-600">Select a company first.</p>
  const all = q.data ?? []
  const match = (t: TaskRow) =>
    (status === 'all' || (status === 'open' ? t.status !== 'approved' && t.status !== 'cancelled' : status === 'review' ? t.status === 'submitted' : t.status === status)) &&
    (!assignee || t.assignee_id === assignee)
  // keep a parent visible when one of its subtasks matches
  const parentsOfMatches = new Set(all.filter((t) => t.parent_id && match(t)).map((t) => t.parent_id))
  const shown = groupTasks(all.filter((t) => match(t) || parentsOfMatches.has(t.id)))
  const awaiting = all.filter((t) => t.status === 'submitted').length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Show">
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="open">Open</option><option value="review">Awaiting approval{awaiting ? ` (${awaiting})` : ''}</option><option value="all">All</option>
              {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
          <Field label="Assigned to">
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Everyone</option>
              {(emps.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </Select>
          </Field>
        </div>
        <Button onClick={() => setForm({})}>New task</Button>
      </div>
      <p className="text-sm text-slate-600">Assign tasks and subtasks to employees. They update progress in the mobile app and submit finished work; you approve it or send it back with a reason.</p>
      {err && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      <Card>
        {q.isLoading ? <Skeleton /> : q.error ? <ErrorNote error={q.error} /> : shown.length === 0 ? <p className="p-4 text-sm text-slate-500">No tasks match.</p> : (
          <div className="divide-y divide-slate-100">
            {shown.map((t) => {
              const p = subProgress(t.subs)
              return (
                <div key={t.id} className="px-3">
                  <TaskLine t={t} today={today} busy={act.isPending} onAction={onAction} onEdit={(x) => setForm({ edit: x })} onAddSub={t.parent_id ? undefined : (x) => setForm({ parent: x })} />
                  {t.subs.length > 0 && (
                    <div className="mb-2 border-l-2 border-slate-200 bg-slate-50/50">
                      <div className="pl-6 pt-1 text-xs text-slate-500">Subtasks: {p.done} of {p.total} approved</div>
                      {t.subs.map((s) => <TaskLine key={s.id} t={s} today={today} indent busy={act.isPending} onAction={onAction} onEdit={(x) => setForm({ edit: x })} />)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
      {form && <TaskForm companyId={companyId} emps={emps.data ?? []} parent={form.parent} edit={form.edit} onClose={() => setForm(null)} />}
      {rejecting && (
        <Modal title={`Send back “${rejecting.title}”`} onClose={() => setRejecting(null)}>
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (note.trim().length < 3) { setErr('Enter a reason (at least 3 characters).'); return } act.mutate({ kind: 'reject', t: rejecting, note }) }} className="space-y-3">
            <Field label="What needs to change?"><Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} autoFocus /></Field>
            <Button type="submit" disabled={act.isPending} className="w-full">Send back</Button>
          </form>
        </Modal>
      )}
    </div>
  )
}

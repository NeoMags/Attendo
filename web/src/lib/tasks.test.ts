import { describe, expect, it } from 'vitest'
import { groupTasks, isOverdue, subProgress, taskError, type TaskRow } from './tasks'

const t = (id: string, over: Partial<TaskRow> = {}): TaskRow => ({
  id, parent_id: null, title: id, description: null, assignee_id: null, priority: 'normal', due_date: null, status: 'todo',
  submit_note: null, review_note: null, submitted_at: null, employees: null, ...over,
})

describe('tasks helpers', () => {
  it('groups subtasks under parents and keeps orphans visible', () => {
    const g = groupTasks([t('p'), t('s1', { parent_id: 'p' }), t('s2', { parent_id: 'p' }), t('orphan', { parent_id: 'hidden' })])
    expect(g.map((x) => x.id)).toEqual(['p', 'orphan'])
    expect(g[0].subs.map((x) => x.id)).toEqual(['s1', 's2'])
  })
  it('progress ignores cancelled subtasks', () => {
    expect(subProgress([t('a', { status: 'approved' }), t('b'), t('c', { status: 'cancelled' })])).toEqual({ done: 1, total: 2 })
  })
  it('overdue only when open and past due', () => {
    expect(isOverdue({ due_date: '2026-11-20', status: 'todo' }, '2026-11-23')).toBe(true)
    expect(isOverdue({ due_date: '2026-11-20', status: 'approved' }, '2026-11-23')).toBe(false)
    expect(isOverdue({ due_date: '2026-11-23', status: 'todo' }, '2026-11-23')).toBe(false)
    expect(isOverdue({ due_date: null, status: 'todo' }, '2026-11-23')).toBe(false)
  })
  it('maps server error codes to readable text', () => {
    expect(taskError('SUBTASKS_OPEN')).toMatch(/subtasks/i)
    expect(taskError('weird')).toBe('weird')
  })
})

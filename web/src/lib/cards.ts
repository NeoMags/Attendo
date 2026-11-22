export type CardId = 'active' | 'checked_in' | 'absent' | 'on_leave' | 'late' | 'device_issues' | 'pending_leave' | 'exits_today' | 'checked_out' | 'attendance_pct'

export interface CardDef { id: CardId; label: string; description: string }

export const CARD_CATALOG: CardDef[] = [
  { id: 'active', label: 'Active employees', description: 'Employees currently active' },
  { id: 'checked_in', label: 'Checked in now', description: 'Employees checked in right now' },
  { id: 'absent', label: 'Absent employees', description: 'Not checked in today and not on approved leave' },
  { id: 'on_leave', label: 'On leave today', description: 'Employees on approved leave today' },
  { id: 'late', label: 'Late today', description: 'Checked in after shift start' },
  { id: 'checked_out', label: 'Checked out', description: 'Finished their day' },
  { id: 'attendance_pct', label: 'Attendance %', description: 'Present today out of active employees' },
  { id: 'device_issues', label: 'Device issues', description: 'Checked-in devices with tracking problems' },
  { id: 'pending_leave', label: 'Pending leave requests', description: 'Waiting for a decision' },
  { id: 'exits_today', label: 'Location exits today', description: 'Geofence exits confirmed today' },
]

export const DEFAULT_CARDS: CardId[] = ['active', 'checked_in', 'absent', 'late', 'device_issues']

/** Saved layout -> valid ordered list: unknown ids dropped, duplicates removed; null/empty array falls back to the default only when nothing was ever saved (null). */
export function normalizeLayout(saved: unknown): CardId[] {
  if (saved == null) return DEFAULT_CARDS
  if (!Array.isArray(saved)) return DEFAULT_CARDS
  const known = new Set<string>(CARD_CATALOG.map((c) => c.id))
  const out: CardId[] = []
  for (const v of saved) if (typeof v === 'string' && known.has(v) && !out.includes(v as CardId)) out.push(v as CardId)
  return out
}

export function moveCard(list: CardId[], id: CardId, delta: -1 | 1): CardId[] {
  const i = list.indexOf(id), j = i + delta
  if (i < 0 || j < 0 || j >= list.length) return list
  const next = [...list]; [next[i], next[j]] = [next[j], next[i]]
  return next
}

/** Replace `oldId` with `newId` in place (no duplicates). */
export function replaceCard(list: CardId[], oldId: CardId, newId: CardId): CardId[] {
  if (oldId === newId || list.includes(newId)) return list
  return list.map((c) => (c === oldId ? newId : c))
}

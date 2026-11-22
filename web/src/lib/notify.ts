export interface Notif { id: string; kind: string; title: string; body: string | null; created_at: string; data: Record<string, unknown> }

const WEEK_MS = 7 * 24 * 3600 * 1000

/** Unread = newer than the user's last "seen" time. With no saved time, only the last 7 days count so a new user is not flooded. */
export function unreadCount(list: Notif[], seenAt: string | null | undefined, now = Date.now()): number {
  const since = seenAt ? Date.parse(seenAt) : now - WEEK_MS
  return list.filter((n) => Date.parse(n.created_at) > since).length
}

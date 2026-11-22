export interface Sched { id: string; employee_id: string; geofence_id: string | null; schedule_date: string; start_time: string; end_time: string; title: string }
export interface EnterEvt { employee_id: string; geofence_id: string; date: string }  // date = company-local date of the confirmed entry
export type VisitStatus = 'visited' | 'missed' | 'pending' | 'no_site'

/** A scheduled visit is 'visited' when the employee entered that site on that day. Past with no entry = missed. Without a site we cannot verify. */
export function visitStatus(s: Sched, enters: EnterEvt[], today: string): VisitStatus {
  if (!s.geofence_id) return 'no_site'
  if (enters.some((e) => e.employee_id === s.employee_id && e.geofence_id === s.geofence_id && e.date === s.schedule_date)) return 'visited'
  return s.schedule_date < today ? 'missed' : 'pending'
}

export const hhmm = (t: string) => t.slice(0, 5)

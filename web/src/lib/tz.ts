/** Offset (ms) of `tz` from UTC at the given instant. */
function offsetMs(tz: string, at: Date): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(at).reduce<Record<string, number>>((a, x) => { if (x.type !== 'literal') a[x.type] = Number(x.value); return a }, {})
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000
}

/** Convert a wall-clock 'YYYY-MM-DDTHH:mm' in `tz` to a UTC ISO string. Returns null if the input is malformed. */
export function zonedToUtcIso(local: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  if (!m) return null
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  if (Number.isNaN(guess)) return null
  let t = guess - offsetMs(tz, new Date(guess))
  t = guess - offsetMs(tz, new Date(t)) // second pass settles DST edges
  return new Date(t).toISOString()
}

/** Inverse: UTC ISO -> 'YYYY-MM-DDTHH:mm' wall-clock in `tz` (for pre-filling datetime-local inputs). */
export function utcIsoToZoned(iso: string, tz: string): string {
  const d = new Date(iso)
  return new Date(d.getTime() + offsetMs(tz, d)).toISOString().slice(0, 16)
}

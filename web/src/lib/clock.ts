/** "Monday, 23 November 2026" and "14:05:09" in the given IANA zone (company timezone). */
export function nowParts(timeZone: string | undefined, now = new Date()) {
  const date = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now)
  return { date, time }
}

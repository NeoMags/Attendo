import { useEffect, useState } from 'react'
import { nowParts } from '@/lib/clock'

/** Live day, date and time in the company's time zone. */
export default function Clock({ timeZone }: { timeZone?: string }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const { date, time } = nowParts(timeZone, now)
  return (
    <div className="text-right leading-tight" aria-live="off">
      <div className="text-sm font-semibold tabular-nums text-slate-900">{time}</div>
      <div className="text-[11px] text-slate-500">{date}</div>
    </div>
  )
}

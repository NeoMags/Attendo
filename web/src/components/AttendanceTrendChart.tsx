import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface TrendPoint { day: string; onTime: number; late: number }

/** Split out of Overview so the (large) charting library loads after the page's numbers are already on screen. */
export default function AttendanceTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" /><YAxis allowDecimals={false} /><Tooltip /><Legend />
        <Bar dataKey="onTime" name="On time" stackId="a" fill="#10b981" />
        <Bar dataKey="late" name="Late" stackId="a" fill="#f59e0b" />
      </BarChart>
    </ResponsiveContainer>
  )
}

// Pure functions with no Electron or DOM dependencies, so they can be tested directly.
import type { Activity, ActivityKind, DayView, TrainingProgram, WeekView, WeeklyPlan } from './types.ts'

const DAY_MS = 86_400_000

/** Local calendar date of a Date as YYYY-MM-DD. */
export function toLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse YYYY-MM-DD as a UTC midnight timestamp, used only for date arithmetic. */
function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / DAY_MS
}

function fromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  return fromDayNumber(dayNumber(date) + days)
}

export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from)
}

/** Monday of the week containing the date. */
export function weekStartOf(date: string): string {
  const n = dayNumber(date)
  const weekday = (new Date(n * DAY_MS).getUTCDay() + 6) % 7 // Monday = 0
  return fromDayNumber(n - weekday)
}

export function emptyPlan(): WeeklyPlan {
  return [[], [], [], [], [], [], []]
}

/** Which week of a program a date falls in, or null outside the program. */
export function programWeek(program: TrainingProgram | null, date: string): number | null {
  if (!program) return null
  const offset = daysBetween(program.start, date)
  if (offset < 0) return null
  const week = Math.floor(offset / 7) + 1
  return week > program.weeks ? null : week
}

export function buildWeek(
  weekStart: string,
  plan: WeeklyPlan,
  activities: Activity[],
  program: TrainingProgram | null
): WeekView {
  const days: DayView[] = []
  let plannedCount = 0
  let plannedDoneCount = 0
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i)
    const dayActivities = activities.filter((a) => a.date === date)
    const planned = plan[i] ?? []
    const doneKinds = new Set<ActivityKind>(dayActivities.map((a) => a.kind))
    const plannedDone = planned.filter((k) => doneKinds.has(k))
    plannedCount += planned.length
    plannedDoneCount += plannedDone.length
    days.push({ date, planned, plannedDone, activities: dayActivities })
  }
  const week = programWeek(program, weekStart) ?? programWeek(program, addDays(weekStart, 6))
  return {
    weekStart,
    days,
    plannedCount,
    plannedDoneCount,
    program:
      program && week ? { name: program.name, week, total: program.weeks, kind: program.kind } : null
  }
}

export interface Point {
  date: string
  value: number
}

/**
 * Trailing average over a window of calendar days (not entries), so gaps in
 * weigh-ins don't distort the trend. One value per input date.
 */
export function rollingAverage(points: Point[], windowDays: number): Point[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  return sorted.map((p) => {
    const inWindow = sorted.filter((q) => {
      const gap = daysBetween(q.date, p.date)
      return gap >= 0 && gap < windowDays
    })
    const value = inWindow.reduce((sum, q) => sum + q.value, 0) / inWindow.length
    return { date: p.date, value }
  })
}

/** Average of the readings on each date, so several weigh-ins on one day count once. */
export function dailyMeans(points: Point[]): Point[] {
  const byDate = new Map<string, number[]>()
  for (const p of points) byDate.set(p.date, [...(byDate.get(p.date) ?? []), p.value])
  return [...byDate.entries()]
    .map(([date, values]) => ({ date, value: values.reduce((s, v) => s + v, 0) / values.length }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export const KG_PER_LB = 0.45359237

export function formatDuration(sec: number | null): string {
  if (sec == null) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.round(sec % 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatPace(secPer500: number | undefined): string {
  if (secPer500 == null || !isFinite(secPer500)) return ''
  const tenths = Math.round(secPer500 * 10) / 10
  const m = Math.floor(tenths / 60)
  const s = (tenths - m * 60).toFixed(1).padStart(4, '0')
  return `${m}:${s} /500m`
}

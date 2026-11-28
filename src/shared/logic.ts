// Pure functions with no Electron or DOM dependencies, so they can be tested directly.
import type { Activity, ActivityKind, DayView, TrainingProgram, WeekView, WeeklyPlan, WeightEntry } from './types.ts'

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

/**
 * Local hour (0-23) of a weigh-in. Withings readings are stored as local
 * "YYYY-MM-DDTHH:MM:SS"; older manual entries were stored as UTC ISO strings.
 */
export function readingHour(measuredAt: string): number {
  if (/(Z|[+-]\d{2}:\d{2})$/.test(measuredAt)) return new Date(measuredAt).getHours()
  const m = measuredAt.match(/T(\d{2}):/)
  return m ? Number(m[1]) : 0
}

/** Readings before noon count as morning weigh-ins. */
export const MORNING_BEFORE_HOUR = 12

/** Days with both a morning and a later reading needed before evening-only days are used. */
export const MIN_GAP_DAYS = 3

export interface MorningPoint extends Point {
  /** True when the morning weight was estimated from that evening's reading. */
  estimated: boolean
}

export interface MorningTrend {
  /** One morning weight per day: measured, or estimated from the evening. */
  daily: MorningPoint[]
  /** Trailing average of the daily morning weights. */
  trend: Point[]
  /** Typical evening minus morning weight (kg), or null until there are enough days with both. */
  gapKg: number | null
  /** Days that had both a morning and a later reading. */
  pairedDays: number
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Builds the weight trend from morning weigh-ins, the most consistent reading
 * of the day. On days with no morning reading, the last reading of the day is
 * used minus this person's own typical morning-to-evening gain, learned from
 * days that have both. Raw evening weights never go into the trend directly.
 */
export function morningTrend(entries: WeightEntry[], windowDays: number): MorningTrend {
  const byDate = new Map<string, WeightEntry[]>()
  for (const e of entries) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e])

  const mornings = new Map<string, number>()
  const laters = new Map<string, number>()
  for (const [date, list] of byDate) {
    const sorted = [...list].sort((a, b) => readingHour(a.measuredAt) - readingHour(b.measuredAt) || a.measuredAt.localeCompare(b.measuredAt))
    const morning = sorted.find((e) => readingHour(e.measuredAt) < MORNING_BEFORE_HOUR)
    const later = [...sorted].reverse().find((e) => readingHour(e.measuredAt) >= MORNING_BEFORE_HOUR)
    if (morning) mornings.set(date, morning.kg)
    if (later) laters.set(date, later.kg)
  }

  // Learn the typical gap from the most recent 60 days that have both readings.
  const gaps = [...mornings.keys()]
    .filter((d) => laters.has(d))
    .sort()
    .slice(-60)
    .map((d) => laters.get(d)! - mornings.get(d)!)
  const gapKg = gaps.length >= MIN_GAP_DAYS ? median(gaps) : null

  const daily: MorningPoint[] = []
  for (const date of [...byDate.keys()].sort()) {
    const m = mornings.get(date)
    if (m != null) daily.push({ date, value: m, estimated: false })
    else if (gapKg != null && laters.has(date)) daily.push({ date, value: laters.get(date)! - gapKg, estimated: true })
  }
  return { daily, trend: rollingAverage(daily, windowDays), gapKg, pairedDays: gaps.length }
}

/**
 * Estimated one-rep max (Epley: weight x (1 + reps/30)). Sets above 12 reps
 * predict a max poorly, so they are left out.
 */
export function estimateOneRepMax(weight: number, reps: number): number | null {
  if (!(weight > 0) || !(reps >= 1) || reps > 12) return null
  return reps === 1 ? weight : weight * (1 + reps / 30)
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

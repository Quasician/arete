// Pure calculations behind the Progress page.
import { addDays, weekStartOf } from './logic.ts'
import { isTraining, type Activity, type AgeGroup, type RowingTrainingLevel, type TypicalMinutes } from './types.ts'

// ---------- weekly active minutes ----------

export const GUIDELINE_MIN = 150
export const GUIDELINE_MAX = 300

export interface WeekMinutes {
  weekStart: string
  /** Minutes from sessions that recorded a duration. */
  measured: number
  /** Minutes filled in from typical session lengths set in Settings. */
  estimated: number
  /** Sessions with no duration and no typical length to fall back on. */
  uncounted: number
}

export function weeklyMinutes(activities: Activity[], typical: TypicalMinutes, weeks: number, today: string): WeekMinutes[] {
  const last = weekStartOf(today)
  const out: WeekMinutes[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = addDays(last, -7 * i)
    const end = addDays(weekStart, 6)
    const week: WeekMinutes = { weekStart, measured: 0, estimated: 0, uncounted: 0 }
    for (const a of activities) {
      if (a.date < weekStart || a.date > end || !isTraining(a.kind)) continue
      if (a.durationSec) week.measured += a.durationSec / 60
      else if (typical[a.kind]) week.estimated += typical[a.kind]!
      else week.uncounted++
    }
    week.measured = Math.round(week.measured)
    out.push(week)
  }
  return out
}

// ---------- strength ----------

export interface LiftPoint {
  date: string
  /** Best estimated one-rep max that day, in kg, or null for bodyweight work. */
  e1rmKg: number | null
  bestReps: number
  /** Longest timed set that day, in seconds, or null. */
  bestSeconds: number | null
}

export interface LiftHistory {
  name: string
  sessions: number
  /** True if the exercise is tracked by reps (bodyweight) rather than load. */
  byReps: boolean
  points: LiftPoint[]
}

/** Per-exercise history from Hevy workouts, most-trained exercises first. */
export function liftHistories(activities: Activity[]): LiftHistory[] {
  const byName = new Map<string, Map<string, LiftPoint>>()
  for (const a of activities) {
    for (const lift of a.detail.lifts ?? []) {
      const days = byName.get(lift.name) ?? new Map<string, LiftPoint>()
      const prev = days.get(a.date)
      days.set(a.date, {
        date: a.date,
        e1rmKg:
          lift.bestE1rmKg == null ? (prev?.e1rmKg ?? null) : Math.max(lift.bestE1rmKg, prev?.e1rmKg ?? 0),
        bestReps: Math.max(lift.bestReps, prev?.bestReps ?? 0),
        bestSeconds:
          lift.bestSeconds == null ? (prev?.bestSeconds ?? null) : Math.max(lift.bestSeconds, prev?.bestSeconds ?? 0)
      })
      byName.set(lift.name, days)
    }
  }
  return [...byName.entries()]
    .map(([name, days]) => {
      const points = [...days.values()].sort((x, y) => x.date.localeCompare(y.date))
      return { name, sessions: points.length, byReps: points.every((p) => p.e1rmKg == null), points }
    })
    .sort((x, y) => y.sessions - x.sessions || x.name.localeCompare(y.name))
}

// ---------- aerobic fitness ----------

/**
 * Men's VO2max percentiles (mL/kg/min) from treadmill tests in the FRIEND
 * registry (Kaminsky et al., Mayo Clin Proc 2015).
 */
export const VO2_PERCENTILES: Record<AgeGroup, Record<number, number>> = {
  '20-29': { 5: 29.0, 10: 32.1, 25: 40.1, 50: 48.0, 75: 55.2, 90: 61.8, 95: 66.3 },
  '30-39': { 5: 27.2, 10: 30.2, 25: 35.9, 50: 42.4, 75: 49.2, 90: 56.5, 95: 59.8 }
}

/** A single, continuous 2,000 m row: the test piece Concept2's VO2max formula is based on. */
export function isTwoKTest(a: Activity): boolean {
  return (
    a.kind === 'row' &&
    a.distanceM === 2000 &&
    !!a.durationSec &&
    a.durationSec >= 300 &&
    a.durationSec <= 900 &&
    !/interval/i.test(a.detail.workoutType ?? '')
  )
}

/**
 * Concept2's VO2max estimate for men from a 2,000 m time and body weight
 * (concept2.com/training/vo2max-calculator). Y is in litres per minute.
 */
export function estimateVo2Max(timeSec: number, weightKg: number, level: RowingTrainingLevel): number {
  const minutes = timeSec / 60
  const y = level === 'high' ? (weightKg > 75 ? 15.7 : 15.1) - 1.5 * minutes : 10.7 - 0.9 * minutes
  return (y * 1000) / weightKg
}

/** Approximate percentile of a VO2max value, interpolating between the table's points. */
export function vo2Percentile(vo2: number, ageGroup: AgeGroup): number {
  const table = Object.entries(VO2_PERCENTILES[ageGroup])
    .map(([p, v]) => [Number(p), v] as const)
    .sort((a, b) => a[0] - b[0])
  if (vo2 <= table[0][1]) return table[0][0]
  for (let i = 1; i < table.length; i++) {
    const [p0, v0] = table[i - 1]
    const [p1, v1] = table[i]
    if (vo2 <= v1) return Math.round(p0 + ((vo2 - v0) / (v1 - v0)) * (p1 - p0))
  }
  return 95
}

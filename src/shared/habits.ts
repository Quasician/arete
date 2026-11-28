// Habits: an if-then plan (a cue and a time), a full and a minimum version,
// and a habit-strength score that grows with each repetition and dips, rather
// than resetting, after a miss. Pure functions so they can be tested.
import { addDays, daysBetween, weekStartOf } from './logic.ts'
import type { Activity, ActivityKind, WeeklyPlan } from './types.ts'

export interface Habit {
  id: string
  name: string
  /** Activities of this type complete the habit (from Hevy, Concept2 or check-ins). */
  kind: ActivityKind
  /** Scheduled weekdays, 0 = Monday ... 6 = Sunday. */
  days: number[]
  /** The "if" of the if-then plan, e.g. "After my alarm goes off". */
  cue: string
  /** Planned start time, "HH:MM", or null. */
  time: string | null
  fullMinutes: number
  minimumMinutes: number
  /** First day the habit counts from, YYYY-MM-DD. */
  startDate: string
  active: boolean
}

export type DoneLevel = 'full' | 'minimum' | 'none'

/**
 * Lally et al. (2010) found habits took 66 days on average to reach their
 * plateau of automaticity. With this rate, 66 repetitions reach 95% strength.
 */
export const REPETITION_RATE = 1 - Math.pow(0.05, 1 / 66)

/** A single miss barely matters; repeated misses add up (also Lally et al.). */
const MISS_PENALTY = [0.03, 0.1, 0.18]

export const MILESTONES = [10, 30, 66, 100, 200]

export function weekdayIndex(date: string): number {
  return daysBetween(weekStartOf(date), date)
}

export function isScheduled(habit: Habit, date: string): boolean {
  return habit.active && date >= habit.startDate && habit.days.includes(weekdayIndex(date))
}

/** How well the habit was done on a day, from the activities logged that day. */
export function doneLevel(habit: Habit, date: string, activities: Activity[]): DoneLevel {
  const matching = activities.filter((a) => a.date === date && a.kind === habit.kind)
  if (matching.length === 0) return 'none'
  // A check-in with no duration counts in full.
  if (matching.some((a) => a.durationSec == null)) return 'full'
  const minutes = matching.reduce((s, a) => s + (a.durationSec ?? 0), 0) / 60
  return minutes >= habit.fullMinutes - 0.5 ? 'full' : 'minimum'
}

export interface DayRecord {
  date: string
  scheduled: boolean
  level: DoneLevel
}

export interface HabitStatus {
  habit: Habit
  /** 0-1: approximate automaticity, from repetitions and misses. */
  strength: number
  repetitions: number
  /** Scheduled days in the last 28 days (up to yesterday) and how many were kept. */
  scheduled28: number
  kept28: number
  /** Misses in a row up to and including yesterday's scheduled day. */
  missStreak: number
  todayScheduled: boolean
  todayLevel: DoneLevel
  /** Today is scheduled, not done yet, and the last scheduled day was missed. */
  dontMissTwice: boolean
  /** The last 28 days, oldest first. */
  days: DayRecord[]
  /** Milestones reached, with the date of the repetition that reached them. */
  milestones: { repetitions: number; date: string }[]
  nextScheduled: string | null
}

export function habitStatus(habit: Habit, activities: Activity[], today: string): HabitStatus {
  const mine = activities.filter((a) => a.kind === habit.kind && a.date >= habit.startDate)
  let strength = 0
  let repetitions = 0
  let missStreak = 0
  const milestones: { repetitions: number; date: string }[] = []
  const last28From = addDays(today, -28)
  let scheduled28 = 0
  let kept28 = 0
  const days: DayRecord[] = []

  const span = Math.max(0, daysBetween(habit.startDate, today))
  for (let i = 0; i <= span; i++) {
    const date = addDays(habit.startDate, i)
    const scheduled = isScheduled(habit, date)
    const level = scheduled || date === today ? doneLevel(habit, date, mine) : 'none'
    if (date >= addDays(today, -27)) days.push({ date, scheduled, level })
    if (!scheduled) continue
    if (date === today && level === 'none') break // today isn't over yet
    if (level !== 'none') {
      strength += (1 - strength) * REPETITION_RATE
      repetitions++
      missStreak = 0
      if (MILESTONES.includes(repetitions)) milestones.push({ repetitions, date })
    } else {
      missStreak++
      strength *= 1 - MISS_PENALTY[Math.min(missStreak, MISS_PENALTY.length) - 1]
    }
    if (date >= last28From && date < today) {
      scheduled28++
      if (level !== 'none') kept28++
    }
  }
  // Pad the calendar so it always shows 28 days, even for a new habit.
  for (let i = 27; i >= 0; i--) {
    const date = addDays(today, -i)
    if (!days.some((d) => d.date === date)) days.push({ date, scheduled: false, level: 'none' })
  }
  days.sort((a, b) => a.date.localeCompare(b.date))

  const todayScheduled = isScheduled(habit, today)
  const todayLevel = doneLevel(habit, today, mine)
  let nextScheduled: string | null = null
  for (let i = todayScheduled && todayLevel === 'none' ? 0 : 1; i <= 7; i++) {
    if (isScheduled(habit, addDays(today, i))) {
      nextScheduled = addDays(today, i)
      break
    }
  }
  return {
    habit,
    strength,
    repetitions,
    scheduled28,
    kept28,
    missStreak: todayScheduled && todayLevel !== 'none' ? 0 : missStreak,
    todayScheduled,
    todayLevel,
    dontMissTwice: todayScheduled && todayLevel === 'none' && missStreak >= 1,
    days,
    milestones,
    nextScheduled
  }
}

/** Suggest a recovery week when a habit has slipped twice in a row, or the week is going badly. */
export function recoverySuggestion(statuses: HabitStatus[]): string | null {
  const slipping = statuses.filter((s) => s.habit.active && s.missStreak >= 2)
  if (slipping.length > 0) {
    const names = slipping.map((s) => s.habit.name).join(' and ')
    return `${names} ${slipping.length === 1 ? 'has' : 'have'} been missed ${slipping.length === 1 ? `${slipping[0].missStreak} times` : 'more than once'} in a row.`
  }
  return null
}

/** Starter habits shaped by the weekly plan in Settings. Everything is editable. */
export function starterHabits(plan: WeeklyPlan, today: string, newId: () => string): Habit[] {
  const daysWith = (kind: ActivityKind, fallback: number[]) => {
    const d = plan.map((kinds, i) => (kinds.includes(kind) ? i : -1)).filter((i) => i >= 0)
    return d.length ? d : fallback
  }
  return [
    {
      id: newId(),
      name: 'Morning row',
      kind: 'row',
      days: daysWith('row', [2, 6]),
      cue: 'After my alarm, before breakfast',
      time: '07:00',
      fullMinutes: 25,
      minimumMinutes: 5,
      startDate: today,
      active: true
    },
    {
      id: newId(),
      name: 'Lifting',
      kind: 'lift',
      days: daysWith('lift', [0, 1, 3, 4]),
      cue: 'After I get home and change',
      time: '18:00',
      fullMinutes: 50,
      minimumMinutes: 15,
      startDate: today,
      active: true
    },
    {
      id: newId(),
      name: 'Daily walk',
      kind: 'walk',
      days: [0, 1, 2, 3, 4, 5, 6],
      cue: 'After my morning coffee',
      time: '06:30',
      fullMinutes: 30,
      minimumMinutes: 10,
      startDate: today,
      active: true
    }
  ]
}

export function validHabit(h: unknown): h is Habit {
  const x = h as Habit
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof x.id === 'string' &&
    x.id.length > 0 &&
    x.id.length <= 40 &&
    typeof x.name === 'string' &&
    x.name.trim().length > 0 &&
    x.name.length <= 60 &&
    typeof x.kind === 'string' &&
    Array.isArray(x.days) &&
    x.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
    typeof x.cue === 'string' &&
    x.cue.length <= 120 &&
    (x.time === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(x.time)) &&
    Number.isInteger(x.fullMinutes) &&
    x.fullMinutes >= 1 &&
    x.fullMinutes <= 600 &&
    Number.isInteger(x.minimumMinutes) &&
    x.minimumMinutes >= 1 &&
    x.minimumMinutes <= x.fullMinutes &&
    /^\d{4}-\d{2}-\d{2}$/.test(x.startDate) &&
    typeof x.active === 'boolean'
  )
}

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
  /** Last day the habit is planned (e.g. a program's end), or null. */
  endDate?: string | null
  /** Stretches when the habit was paused: [from, to), to = null while still paused. */
  pauses?: { from: string; to: string | null }[]
  /** Waiting in the "Up next" queue: not started yet. */
  queued?: boolean
  /** Position in the queue, lowest first. */
  queueOrder?: number
  /** Recurring Todoist tasks (labelled @habit) this habit comes from. */
  todoistTaskIds?: string[]
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

/** Strength and consistency at which a habit counts as formed. */
export const FORMED_STRENGTH = 0.9
export const FORMED_KEPT_RATE = 0.8
/** A formed habit whose strength falls below this needs attention. */
export const ATTENTION_STRENGTH = 0.75

export type Stage = 'upcoming' | 'queued' | 'starting' | 'building' | 'sticking' | 'formed'

export const STAGE_LABELS: Record<Stage, string> = {
  upcoming: 'Starts soon',
  queued: 'Up next',
  starting: 'Starting',
  building: 'Building',
  sticking: 'Sticking',
  formed: 'Formed'
}

/** Repetitions in a row needed to take strength from `from` to `to`. */
export function repetitionsBetween(from: number, to: number): number {
  if (from >= to) return 0
  return Math.ceil(Math.log((1 - to) / (1 - from)) / Math.log(1 - REPETITION_RATE))
}

export function weekdayIndex(date: string): number {
  return daysBetween(weekStartOf(date), date)
}

function pausedOn(habit: Habit, date: string): boolean {
  return (habit.pauses ?? []).some((p) => date >= p.from && (p.to === null || date < p.to))
}

export function isScheduled(habit: Habit, date: string): boolean {
  if (habit.queued || date < habit.startDate) return false
  if (habit.endDate && date > habit.endDate) return false
  // Paused habits keep their history up to the pause; habits paused before
  // pauses were recorded have none to show.
  if (!habit.active && !(habit.pauses ?? []).some((p) => p.to === null)) return false
  if (pausedOn(habit, date)) return false
  return habit.days.includes(weekdayIndex(date))
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
  stage: Stage
  /** The day the habit first reached formed strength with steady consistency, or null. */
  formedOn: string | null
  /** Formed, but strength has slipped since. */
  needsAttention: boolean
  /** Repetitions in a row still needed to reach formed strength (0 once there). */
  toFormed: number
  /** Scheduled days and kept days in the last 14 days (up to yesterday). */
  scheduled14: number
  kept14: number
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

  let formedOn: string | null = null
  const recent: { date: string; kept: boolean }[] = []
  const last14From = addDays(today, -14)
  let scheduled14 = 0
  let kept14 = 0

  // A habit that starts later has no days to count yet.
  const span = daysBetween(habit.startDate, today)
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
    if (date >= last14From && date < today) {
      scheduled14++
      if (level !== 'none') kept14++
    }
    // Formed: strong, and kept at least 80% of the last four weeks (at least four planned days).
    recent.push({ date, kept: level !== 'none' })
    while (recent.length && recent[0].date < addDays(date, -27)) recent.shift()
    if (!formedOn && strength >= FORMED_STRENGTH && recent.length >= 4) {
      if (recent.filter((r) => r.kept).length / recent.length >= FORMED_KEPT_RATE) formedOn = date
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
  const stage: Stage = habit.queued
    ? 'queued'
    : formedOn
      ? 'formed'
      : habit.startDate > today
        ? 'upcoming'
        : strength < 0.25
          ? 'starting'
          : strength < 0.6
            ? 'building'
            : 'sticking'
  return {
    habit,
    strength,
    repetitions,
    stage,
    formedOn,
    needsAttention: !!formedOn && strength < ATTENTION_STRENGTH,
    toFormed: repetitionsBetween(strength, FORMED_STRENGTH),
    scheduled14,
    kept14,
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

function shortDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Days a new habit should hold before the next one in the queue starts. */
export const HOLD_DAYS = 14

export interface QueueAdvice {
  /** True when it's a good time to start the next queued habit. */
  ready: boolean
  /** The newest active habit, which the advice is about. */
  newest: HabitStatus | null
  /** Plain-language reason. */
  reason: string
}

/**
 * One new habit at a time: the next one in the queue is suggested once the newest
 * active habit has held for two weeks, kept on at least 80% of its planned days.
 */
export function queueAdvice(statuses: HabitStatus[], today: string): QueueAdvice {
  const active = statuses.filter((s) => s.habit.active && !s.habit.queued && s.stage !== 'formed')
  const newest = [...active].sort((a, b) => b.habit.startDate.localeCompare(a.habit.startDate))[0] ?? null
  if (!newest) return { ready: true, newest: null, reason: 'Every active habit is formed, so there is room for a new one.' }
  const name = newest.habit.name
  if (newest.habit.startDate > today) {
    return { ready: false, newest, reason: `${name} starts ${shortDate(newest.habit.startDate)}. Give it two steady weeks first.` }
  }
  const held = daysBetween(newest.habit.startDate, today)
  if (held < HOLD_DAYS) {
    const left = HOLD_DAYS - held
    return { ready: false, newest, reason: `${name} is ${held} day${held === 1 ? '' : 's'} in. Give it ${left} more day${left === 1 ? '' : 's'} before adding the next.` }
  }
  if (newest.scheduled14 < 3 || newest.kept14 / newest.scheduled14 < FORMED_KEPT_RATE) {
    return { ready: false, newest, reason: `${name} was kept ${newest.kept14} of ${newest.scheduled14} times in the last two weeks. Aim for 80% before adding the next.` }
  }
  return { ready: true, newest, reason: `${name} has held for two weeks (${newest.kept14} of ${newest.scheduled14}). Time to add the next one.` }
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
    typeof x.active === 'boolean' &&
    (x.endDate == null || /^\d{4}-\d{2}-\d{2}$/.test(x.endDate)) &&
    (x.pauses == null ||
      (Array.isArray(x.pauses) &&
        x.pauses.length <= 50 &&
        x.pauses.every(
          (p) => /^\d{4}-\d{2}-\d{2}$/.test(p?.from) && (p.to === null || /^\d{4}-\d{2}-\d{2}$/.test(p.to))
        ))) &&
    (x.queued == null || typeof x.queued === 'boolean') &&
    (x.queueOrder == null || Number.isInteger(x.queueOrder)) &&
    (x.todoistTaskIds == null ||
      (Array.isArray(x.todoistTaskIds) &&
        x.todoistTaskIds.length <= 20 &&
        x.todoistTaskIds.every((t) => typeof t === 'string' && t.length > 0 && t.length <= 40)))
  )
}

/** Pauses or resumes a habit, keeping its history either side of the pause. */
export function setActive(habit: Habit, active: boolean, today: string): Habit {
  if (habit.active === active) return habit
  const pauses = [...(habit.pauses ?? [])]
  if (!active) pauses.push({ from: today, to: null })
  else {
    const open = pauses.findIndex((p) => p.to === null)
    if (open >= 0) pauses[open] = { ...pauses[open], to: today }
  }
  return { ...habit, active, pauses: pauses.filter((p) => p.to === null || p.to > p.from) }
}

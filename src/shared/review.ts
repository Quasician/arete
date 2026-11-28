// The weekly review: how each habit went, which one slipped, and up to three
// concrete changes for next week.
import { addDays, weekStartOf } from './logic.ts'
import { doneLevel, isScheduled, type Habit } from './habits.ts'
import type { Activity } from './types.ts'

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export interface HabitWeek {
  habit: Habit
  scheduled: number
  full: number
  minimum: number
}

export interface WeeklyReview {
  weekStart: string
  habits: HabitWeek[]
  keptRate: number | null
  /** The habit with the lowest kept rate, if any slipped. */
  slipped: string | null
  suggestions: string[]
}

export function weekOf(habit: Habit, weekStart: string, activities: Activity[], upTo: string): HabitWeek {
  const out: HabitWeek = { habit, scheduled: 0, full: 0, minimum: 0 }
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i)
    if (date > upTo || !isScheduled(habit, date)) continue
    out.scheduled++
    const level = doneLevel(habit, date, activities)
    if (level === 'full') out.full++
    else if (level === 'minimum') out.minimum++
  }
  return out
}

/**
 * Review of the week starting `weekStart`, counting days up to `upTo`
 * (yesterday for the current week). Suggestions look back four weeks.
 */
export function weeklyReview(habits: Habit[], activities: Activity[], weekStart: string, upTo: string): WeeklyReview {
  const active = habits.filter((h) => h.active)
  const weeks = active.map((h) => weekOf(h, weekStart, activities, upTo))
  const scheduled = weeks.reduce((s, w) => s + w.scheduled, 0)
  const kept = weeks.reduce((s, w) => s + w.full + w.minimum, 0)
  const rate = (w: HabitWeek) => (w.scheduled ? (w.full + w.minimum) / w.scheduled : 1)
  const worst = [...weeks].filter((w) => w.scheduled > 0).sort((a, b) => rate(a) - rate(b))[0]

  const suggestions: string[] = []
  for (const h of active) {
    // A weekday missed at least 3 of the last 4 times it came up.
    const misses = new Map<number, { due: number; missed: number }>()
    for (let i = 1; i <= 28; i++) {
      const date = addDays(upTo, -i + 1)
      if (date < h.startDate || !isScheduled(h, date)) continue
      const wd = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
      const m = misses.get(wd) ?? { due: 0, missed: 0 }
      m.due++
      if (doneLevel(h, date, activities) === 'none') m.missed++
      misses.set(wd, m)
    }
    for (const [wd, m] of misses) {
      if (m.due >= 3 && m.missed / m.due >= 0.75) {
        suggestions.push(
          `${h.name} keeps slipping on ${DAY_NAMES[wd]}s (missed ${m.missed} of the last ${m.due}). Move it to another day, or plan the ${h.minimumMinutes}-minute minimum for ${DAY_NAMES[wd]}s.`
        )
      }
    }
    // Kept every time in full for three weeks running: ready for a little more.
    const last3 = [0, 1, 2].map((k) => weekOf(h, addDays(weekStartOf(upTo), -7 * (k + 1)), activities, upTo))
    if (last3.every((w) => w.scheduled > 0 && w.full === w.scheduled)) {
      suggestions.push(
        `${h.name} has been done in full every time for three weeks. If it feels easy, raise the full version to about ${Math.round(h.fullMinutes * 1.1)} minutes.`
      )
    }
    // Mostly minimums: fine for keeping the habit, but worth a look.
    const w = weeks.find((x) => x.habit.id === h.id)!
    if (w.scheduled >= 3 && w.minimum > w.full && w.minimum >= 2) {
      suggestions.push(
        `${h.name} was mostly the minimum version this week. That still builds the habit; if it keeps happening, check whether the time or the cue is wrong.`
      )
    }
  }

  return {
    weekStart,
    habits: weeks,
    keptRate: scheduled ? kept / scheduled : null,
    slipped: worst && rate(worst) < 1 ? worst.habit.name : null,
    suggestions: suggestions.slice(0, 3)
  }
}

/** Plain-text summary for the Sunday review task in Todoist. */
export function reviewText(review: WeeklyReview): string {
  const lines = review.habits.map(
    (w) => `${w.habit.name}: ${w.full + w.minimum}/${w.scheduled} kept${w.minimum ? ` (${w.minimum} minimum)` : ''}`
  )
  if (review.slipped) lines.push(`Slipped most: ${review.slipped}`)
  if (review.suggestions.length) lines.push('', 'For next week:', ...review.suggestions.map((s) => `- ${s}`))
  return lines.join('\n')
}

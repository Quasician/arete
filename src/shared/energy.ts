// Energy balance: compares logged calories with the weight trend to estimate
// how much you actually burn, from your own data rather than a formula.
import { addDays, daysBetween, type Point } from './logic.ts'
import type { Meal } from './types.ts'

/** Roughly 7,700 kcal per kg (3,500 per lb) of body-weight change. */
export const KCAL_PER_KG = 7700

/** A day counts as logged once it has at least this many meals with calories. */
export const MIN_MEALS_PER_DAY = 2
export const WINDOW_DAYS = 21
export const MIN_LOGGED_DAYS = 10

export interface DayIntake {
  date: string
  kcal: number
  meals: number
}

/** Total calories per day, counting only days logged well enough to trust. */
export function loggedDays(meals: Meal[]): DayIntake[] {
  const byDate = new Map<string, DayIntake>()
  for (const m of meals) {
    if (m.kcal == null) continue
    const d = byDate.get(m.date) ?? { date: m.date, kcal: 0, meals: 0 }
    d.kcal += m.kcal
    d.meals++
    byDate.set(m.date, d)
  }
  return [...byDate.values()].filter((d) => d.meals >= MIN_MEALS_PER_DAY).sort((a, b) => a.date.localeCompare(b.date))
}

export interface Balance {
  end: string
  /** Average calories on logged days in the window. */
  intake: number
  loggedDays: number
  /** Change in trend weight across the window, kg. */
  weightChangeKg: number
  /** Estimated calories burned per day. */
  burn: number
}

function trendOn(trend: Point[], date: string): number | null {
  // The closest trend value on or before the date, within three days.
  for (let i = trend.length - 1; i >= 0; i--) {
    if (trend[i].date <= date) return daysBetween(trend[i].date, date) <= 3 ? trend[i].value : null
  }
  return null
}

/**
 * Burn = average intake minus the energy that went into (or came out of)
 * stored weight over the window. Needs enough logged days and a weight trend
 * at both ends of the window.
 */
export function balanceAt(end: string, days: DayIntake[], trend: Point[], windowDays = WINDOW_DAYS): Balance | null {
  const start = addDays(end, -(windowDays - 1))
  const inWindow = days.filter((d) => d.date >= start && d.date <= end)
  if (inWindow.length < MIN_LOGGED_DAYS) return null
  const w0 = trendOn(trend, start)
  const w1 = trendOn(trend, end)
  if (w0 == null || w1 == null) return null
  const intake = inWindow.reduce((s, d) => s + d.kcal, 0) / inWindow.length
  const weightChangeKg = w1 - w0
  const burn = intake - (weightChangeKg * KCAL_PER_KG) / windowDays
  return { end, intake: Math.round(intake), loggedDays: inWindow.length, weightChangeKg, burn: Math.round(burn) }
}

/** Weekly points for a chart: average intake that week and the 21-day burn estimate ending that day. */
export function balanceSeries(days: DayIntake[], trend: Point[], today: string, weeks = 16) {
  const out: { end: string; weekIntake: number | null; burn: number | null }[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const end = addDays(today, -7 * i)
    const week = days.filter((d) => d.date > addDays(end, -7) && d.date <= end)
    const b = balanceAt(end, days, trend)
    out.push({
      end,
      weekIntake: week.length ? Math.round(week.reduce((s, d) => s + d.kcal, 0) / week.length) : null,
      burn: b?.burn ?? null
    })
  }
  return out
}

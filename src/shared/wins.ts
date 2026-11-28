// Immediate rewards: personal records and habit milestones, newest first.
import { addDays, type Point } from './logic.ts'
import { estimateVo2Max, isTwoKTest, liftHistories } from './progress.ts'
import type { HabitStatus } from './habits.ts'
import type { Activity } from './types.ts'

export interface Win {
  /** Stable id, so a win is only announced once. */
  id: string
  date: string
  kind: 'lift' | 'row' | 'weight' | 'habit'
  title: string
  detail: string
}

const MIN_HISTORY = 2

export function findWins(
  activities: Activity[],
  trend: Point[],
  statuses: HabitStatus[],
  formatKg: (kg: number) => string,
  since: string
): Win[] {
  const wins: Win[] = []

  // Lift records: a new best estimated 1RM after at least two earlier sessions.
  for (const h of liftHistories(activities)) {
    if (h.byReps) {
      let best = 0
      h.points.forEach((p, i) => {
        if (i >= MIN_HISTORY && p.bestReps > best && p.date >= since)
          wins.push({ id: `reps:${h.name}:${p.date}`, date: p.date, kind: 'lift', title: `${h.name}: ${p.bestReps} reps`, detail: `Most in a set so far (previous best ${best})` })
        best = Math.max(best, p.bestReps)
      })
    } else {
      let best = 0
      h.points.forEach((p, i) => {
        if (p.e1rmKg == null) return
        if (i >= MIN_HISTORY && p.e1rmKg > best + 0.05 && p.date >= since)
          wins.push({ id: `e1rm:${h.name}:${p.date}`, date: p.date, kind: 'lift', title: `${h.name}: new best`, detail: `Estimated one-rep max ${formatKg(p.e1rmKg)} (previous ${formatKg(best)})` })
        best = Math.max(best, p.e1rmKg)
      })
    }
  }

  // Fastest 2,000 m.
  let fastest = Infinity
  for (const a of activities.filter(isTwoKTest).sort((x, y) => x.date.localeCompare(y.date))) {
    if (a.durationSec! < fastest && fastest !== Infinity && a.date >= since) {
      wins.push({ id: `2k:${a.date}`, date: a.date, kind: 'row', title: 'Fastest 2,000 m', detail: `${Math.floor(a.durationSec! / 60)}:${String(Math.round(a.durationSec! % 60)).padStart(2, '0')}, ${Math.round(fastest - a.durationSec!)} s faster than before` })
    }
    fastest = Math.min(fastest, a.durationSec!)
  }
  void estimateVo2Max // VO2max follows the 2k time, so the 2k record covers it.

  // Trend weight dropping below a new whole kilogram (about 2.2 lb), after 30 days of data.
  if (trend.length > 0) {
    let low = trend[0].value
    for (const p of trend) {
      if (p.value < low) {
        if (Math.floor(p.value) < Math.floor(low) && p.date >= since && p.date >= addDays(trend[0].date, 30)) {
          wins.push({
            id: `weight:${Math.floor(p.value)}`,
            date: p.date,
            kind: 'weight',
            title: 'New low trend weight',
            detail: `${formatKg(p.value)}, the lowest since you started tracking`
          })
        }
        low = p.value
      }
    }
  }

  // Habit milestones.
  for (const s of statuses) {
    for (const m of s.milestones) {
      if (m.date < since) continue
      wins.push({
        id: `habit:${s.habit.id}:${m.repetitions}`,
        date: m.date,
        kind: 'habit',
        title: `${s.habit.name}: ${m.repetitions} times`,
        detail: m.repetitions === 66 ? 'The average point where a habit becomes automatic' : `${m.repetitions} repetitions since you started`
      })
    }
  }

  return wins.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
}

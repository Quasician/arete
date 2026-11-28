// Week-to-week progression for Hevy routines, so the numbers move toward your
// goals without doing the maths. Double progression, the same rule Hevy
// Trainer uses: keep the weight and add reps until every working set reaches
// the top of the range, then add one weight step and start again at the bottom.
// Pure functions, so they can be tested.
import type { Activity } from './types.ts'

export interface RoutineSet {
  type: string
  weight_kg?: number | null
  reps?: number | null
  distance_meters?: number | null
  duration_seconds?: number | null
  custom_metric?: number | null
  rep_range?: { start: number; end: number } | null
}

export interface RoutineExercise {
  title: string
  exercise_template_id: string
  superset_id: number | null
  rest_seconds: number | null
  notes: string | null
  sets: RoutineSet[]
}

export interface Routine {
  id: string
  title: string
  notes: string | null
  exercises: RoutineExercise[]
}

export interface Performed {
  date: string
  sets: { kg: number | null; reps: number | null; sec: number | null }[]
}

export type RepRange = [number, number]

export interface ProgressionSettings {
  /** Write the new targets into the Hevy routines after each sync. */
  enabled: boolean
  /** One weight step in kg (both dumbbells together, as you log them). */
  stepKg: number
  /** Rep ranges by Hevy exercise template id; others use the defaults. */
  ranges: Record<string, RepRange>
}

export const MAIN_RANGE: RepRange = [6, 10]
export const ACCESSORY_RANGE: RepRange = [8, 12]
export const LB = 0.45359237
/** 5 lb for both dumbbells together: one 2.5 lb step on each. */
export const DEFAULT_STEP_KG = 5 * LB

export interface Change {
  routineId: string
  routine: string
  exercise: string
  templateId: string
  from: string
  to: string
  why: string
}

/** The latest working sets of each exercise, by Hevy exercise template id. */
export function latestPerformance(activities: Activity[]): Map<string, Performed> {
  const out = new Map<string, Performed>()
  for (const a of [...activities].sort((x, y) => (x.startedAt ?? x.date).localeCompare(y.startedAt ?? y.date))) {
    for (const l of a.detail.lifts ?? []) {
      if (!l.templateId || !l.workSets?.length) continue
      out.set(l.templateId, { date: a.date, sets: l.workSets })
    }
  }
  return out
}

function roundTo(kg: number, step: number): number {
  return Math.round(Math.round(kg / step) * step * 1000) / 1000
}

const isWork = (s: RoutineSet) => s.type !== 'warmup'

/** Warm-ups, stretching and the like are routines of drills, not lifts to progress. */
export const NOT_PROGRESSED = /warm[\s-]?up|stretch|cool[\s-]?down|mobility|foam roll/i

function describe(sets: RoutineSet[], show: (kg: number) => string): string {
  const work = sets.filter(isWork)
  if (!work.length) return '–'
  const s = work[0]
  const reps = s.rep_range ? `${s.reps ?? s.rep_range.start} (${s.rep_range.start}–${s.rep_range.end})` : s.reps != null ? String(s.reps) : null
  if (s.duration_seconds) return `${work.length} × ${s.duration_seconds} s`
  if (s.weight_kg) {
    const weights = [...new Set(work.map((w) => show(w.weight_kg ?? 0)))]
    return `${work.length} × ${reps ?? '?'} @ ${weights.join(' / ')}`
  }
  return `${work.length} × ${reps ?? '?'}`
}

/**
 * Next targets for one exercise from its latest session. Returns the new sets
 * and why, or null to leave it as it is.
 */
export function progressExercise(
  ex: RoutineExercise,
  last: Performed | null,
  range: RepRange,
  stepKg: number
): { sets: RoutineSet[]; why: string } | null {
  if (!last || NOT_PROGRESSED.test(ex.title)) return null
  const work = ex.sets.filter(isWork)
  if (!work.length) return null
  const [lo, hi] = range
  const done = last.sets
  const planned = Math.max(0, ...work.map((s) => s.weight_kg ?? 0))
  const lifted = Math.max(0, ...done.map((s) => s.kg ?? 0))
  let next: (s: RoutineSet) => RoutineSet
  let why: string

  if (planned > 0 || lifted > 0) {
    // Only move on once the planned weight has actually been lifted.
    if (planned > 0 && lifted < planned - 0.05) return null
    // Every working set counts, so ramped sets (lighter first) move together.
    const reps = done.filter((s) => (s.kg ?? 0) > 0).map((s) => s.reps ?? 0)
    const fewest = Math.min(...reps)
    let weight = lifted
    let target: number
    if (fewest >= hi && reps.length >= work.length) {
      weight = roundTo(lifted + stepKg, stepKg)
      target = lo
      why = `Every set reached ${hi}: one step heavier, back to ${lo} reps`
    } else if (Math.max(...reps) < lo - 1) {
      weight = roundTo(Math.max(stepKg, lifted - stepKg), stepKg)
      target = lo
      why = `Under ${lo} reps last time: one step lighter to build back up`
    } else {
      target = Math.min(hi, Math.max(lo, fewest + 1))
      why = `Same weight, aim for ${target} on every set`
    }
    // Ramped sets (e.g. 100 then 120) keep their spacing: every working set moves by the same amount.
    const shift = planned > 0 ? weight - planned : 0
    next = (s) =>
      isWork(s)
        ? {
            ...s,
            weight_kg: planned > 0 && s.weight_kg ? Math.round((s.weight_kg + shift) * 1000) / 1000 : weight,
            reps: target,
            rep_range: { start: lo, end: hi }
          }
        : s
  } else if (done.some((s) => s.sec) || work.some((s) => s.duration_seconds)) {
    // Only straight holds (every set the same length) move on; mixed lengths are drills.
    if (new Set(work.map((s) => s.duration_seconds ?? 0)).size > 1) return null
    const best = Math.max(0, ...done.map((s) => s.sec ?? 0))
    if (!best) return null
    const target = Math.ceil((best + 5) / 5) * 5
    next = (s) => (isWork(s) ? { ...s, duration_seconds: target } : s)
    why = `Held ${best} s: aim for ${target} s`
  } else {
    const reps = done.map((s) => s.reps ?? 0).filter((r) => r > 0)
    if (!reps.length) return null
    const target = Math.min(30, Math.min(...reps) + 1)
    next = (s) => (isWork(s) ? { ...s, reps: target, rep_range: null } : s)
    why = `Fewest reps last time was ${Math.min(...reps)}: aim for ${target} on every set`
  }

  const sets = ex.sets.map(next)
  const same = JSON.stringify(sets.filter(isWork)) === JSON.stringify(work)
  return same ? null : { sets, why }
}

/** New versions of the routines that change, and a plain list of what changed. */
export function planRoutines(
  routines: Routine[],
  performance: Map<string, Performed>,
  rangeFor: (ex: RoutineExercise) => RepRange,
  stepKg: number,
  show: (kg: number) => string
): { routines: Routine[]; changes: Change[] } {
  const changed: Routine[] = []
  const changes: Change[] = []
  for (const r of routines) {
    let touched = false
    const exercises = r.exercises.map((ex) => {
      const p = progressExercise(ex, performance.get(ex.exercise_template_id) ?? null, rangeFor(ex), stepKg)
      if (!p) return ex
      touched = true
      changes.push({
        routineId: r.id,
        routine: r.title,
        exercise: ex.title,
        templateId: ex.exercise_template_id,
        from: describe(ex.sets, show),
        to: describe(p.sets, show),
        why: p.why
      })
      return { ...ex, sets: p.sets }
    })
    if (touched) changed.push({ ...r, exercises })
  }
  return { routines: changed, changes }
}

/**
 * Sessions until a goal's estimated one-rep max is reached if each session
 * adds a rep (and a step at the top of the range). Null if not within a year.
 */
export function sessionsToTarget(weightKg: number, reps: number, targetKg: number, range: RepRange, stepKg: number): number | null {
  const e1rm = (w: number, r: number) => w * (1 + r / 30)
  let w = weightKg
  let r = reps
  for (let n = 0; n <= 52; n++) {
    if (e1rm(w, r) >= targetKg - 0.05) return n
    if (r >= range[1]) {
      w = roundTo(w + stepKg, stepKg)
      r = range[0]
    } else r++
  }
  return null
}

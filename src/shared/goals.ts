// Strength goals: a lift, a starting number, a target and a deadline. Progress
// comes from Hevy: estimated one-rep max for loaded lifts, reps for bodyweight
// lifts, seconds for holds. Pure functions, so they can be tested.
import { addDays, daysBetween } from './logic.ts'
import type { LiftHistory, LiftPoint } from './progress.ts'
import type { Units } from './types.ts'

export type GoalMetric = 'e1rm' | 'reps' | 'seconds'

export const BODY_REGIONS = [
  'chest',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'core',
  'upperBack',
  'lowerBack',
  'glutes',
  'quads',
  'hamstrings',
  'hips',
  'calves'
] as const
export type BodyRegion = (typeof BODY_REGIONS)[number]

export const REGION_LABELS: Record<BodyRegion, string> = {
  chest: 'Chest',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms and grip',
  core: 'Core',
  upperBack: 'Upper back and lats',
  lowerBack: 'Lower back',
  glutes: 'Glutes',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  hips: 'Hips',
  calves: 'Calves and ankles'
}

export interface LiftGoal {
  id: string
  /** What you call it, e.g. "DB bench press". */
  label: string
  /** The Hevy exercise it reads from, or null until one is picked. */
  exercise: string | null
  metric: GoalMetric
  regions: BodyRegion[]
  startDate: string
  deadline: string
  /** Starting number (kg for e1rm, reps, or seconds). Null: taken from your history. */
  baseline: number | null
  /** Target in the same unit. Null: worked out from the baseline with `rule`. */
  target: number | null
  /** How a missing target is set: a percentage on top, or a fixed amount added. */
  rule: { pct?: number; add?: number }
}

export interface GoalProgress {
  goal: LiftGoal
  history: LiftHistory | null
  baseline: number | null
  target: number | null
  /** Latest value since the start, and the best. */
  latest: { date: string; value: number } | null
  best: { date: string; value: number } | null
  /** 0–1 from baseline to target, by the best value since the start. */
  progress: number
  /** Where a straight line from baseline to target would be today, 0–1. */
  expected: number
  reachedOn: string | null
  status: 'no-exercise' | 'no-data' | 'reached' | 'ahead' | 'on-pace' | 'behind' | 'not-started'
  /** Values since four weeks before the start, for the chart. */
  series: { date: string; value: number }[]
}

export function metricValue(p: LiftPoint, metric: GoalMetric): number | null {
  if (metric === 'e1rm') return p.e1rmKg
  if (metric === 'reps') return p.bestReps > 0 ? p.bestReps : null
  return p.bestSeconds
}

/** Rounds a target to a sensible step: 1 lb or 0.5 kg, whole reps, 5 seconds. */
export function roundTarget(value: number, metric: GoalMetric, units: Units): number {
  if (metric === 'reps') return Math.round(value)
  if (metric === 'seconds') return Math.round(value / 5) * 5
  const LB = 0.45359237
  return units === 'lb' ? Math.round(value / LB) * LB : Math.round(value * 2) / 2
}

export function goalProgress(goal: LiftGoal, histories: LiftHistory[], today: string, units: Units): GoalProgress {
  const history = goal.exercise ? (histories.find((h) => h.name === goal.exercise) ?? null) : null
  const values = (history?.points ?? [])
    .map((p) => ({ date: p.date, value: metricValue(p, goal.metric) }))
    .filter((x): x is { date: string; value: number } => x.value != null)

  // Baseline: your best in the four weeks before the start, else the first session after it.
  let baseline = goal.baseline
  if (baseline == null) {
    const before = values.filter((v) => v.date <= goal.startDate && v.date > addDays(goal.startDate, -28))
    baseline = before.length ? Math.max(...before.map((v) => v.value)) : (values.find((v) => v.date >= goal.startDate)?.value ?? null)
  }
  let target = goal.target
  if (target == null && baseline != null) {
    const raw = goal.rule.pct ? baseline * (1 + goal.rule.pct / 100) : baseline + (goal.rule.add ?? 0)
    target = roundTarget(raw, goal.metric, units)
  }

  const since = values.filter((v) => v.date >= goal.startDate && v.date <= today)
  const latest = since.at(-1) ?? null
  const best = since.length ? since.reduce((a, b) => (b.value > a.value ? b : a)) : null
  const span = Math.max(1, daysBetween(goal.startDate, goal.deadline))
  const expected = Math.min(1, Math.max(0, daysBetween(goal.startDate, today) / span))
  const reached = target != null ? since.find((v) => v.value >= target! - 1e-9) : undefined

  let progress = 0
  if (best && target != null) {
    if (baseline != null && target > baseline) progress = (best.value - baseline) / (target - baseline)
    else progress = best.value >= target ? 1 : best.value / target
  }
  progress = Math.min(1, Math.max(0, progress))

  let status: GoalProgress['status']
  if (!goal.exercise) status = 'no-exercise'
  else if (reached) status = 'reached'
  else if (today < goal.startDate) status = 'not-started'
  else if (!best) status = 'no-data'
  else if (progress >= expected + 0.1) status = 'ahead'
  else if (progress >= expected - 0.15) status = 'on-pace'
  else status = 'behind'

  return {
    goal,
    history,
    baseline,
    target,
    latest,
    best,
    progress,
    expected,
    reachedOn: reached?.date ?? null,
    status,
    series: values.filter((v) => v.date >= addDays(goal.startDate, -28))
  }
}

/** Progress for each body region: the average of the goals that train it. */
export function regionProgress(progress: GoalProgress[]): Map<BodyRegion, { value: number; goals: string[] }> {
  const out = new Map<BodyRegion, { sum: number; n: number; goals: string[] }>()
  for (const p of progress) {
    if (p.status === 'no-exercise' || p.target == null) continue
    for (const r of p.goal.regions) {
      const cur = out.get(r) ?? { sum: 0, n: 0, goals: [] }
      cur.sum += p.progress
      cur.n++
      cur.goals.push(p.goal.id)
      out.set(r, cur)
    }
  }
  return new Map([...out].map(([r, v]) => [r, { value: v.sum / v.n, goals: v.goals }]))
}

// ---------- the suggested block ----------

interface Suggestion {
  label: string
  match: RegExp[]
  metric: GoalMetric
  regions: BodyRegion[]
  rule: LiftGoal['rule']
  target?: number
}

/** A strength-and-tendons block for home dumbbells, climbing and trail running. */
const SUGGESTED: Suggestion[] = [
  { label: 'DB bench press', match: [/bench/i, /dumbbell|\bdb\b/i], metric: 'e1rm', regions: ['chest', 'shoulders', 'triceps'], rule: { pct: 10 } },
  { label: 'Bulgarian split squat', match: [/bulgarian|split squat/i], metric: 'e1rm', regions: ['quads', 'glutes'], rule: { pct: 10 } },
  { label: 'DB Romanian deadlift', match: [/romanian|\brdl\b/i], metric: 'e1rm', regions: ['hamstrings', 'glutes', 'lowerBack'], rule: { pct: 10 } },
  { label: 'Pull-ups', match: [/pull[\s-]?up|chin[\s-]?up/i], metric: 'reps', regions: ['upperBack', 'biceps', 'forearms'], rule: { add: 3 } },
  { label: 'Dead hang', match: [/hang/i], metric: 'seconds', regions: ['forearms', 'shoulders'], rule: {}, target: 60 },
  { label: 'Deep squat hold', match: [/squat hold|deep squat|sit(ting)? squat/i], metric: 'seconds', regions: ['hips', 'calves'], rule: {}, target: 120 }
]

/** Picks the Hevy exercise that best matches, preferring the one trained most. */
export function guessExercise(match: RegExp[], metric: GoalMetric, histories: LiftHistory[]): string | null {
  const fits = histories.filter(
    (h) => match.every((re) => re.test(h.name)) && h.points.some((p) => metricValue(p, metric) != null)
  )
  return fits[0]?.name ?? histories.find((h) => match.every((re) => re.test(h.name)))?.name ?? null
}

export function suggestedGoals(histories: LiftHistory[], startDate: string, deadline: string, newId: () => string): LiftGoal[] {
  return SUGGESTED.map((s) => ({
    id: newId(),
    label: s.label,
    exercise: guessExercise(s.match, s.metric, histories),
    metric: s.metric,
    regions: s.regions,
    startDate,
    deadline,
    baseline: null,
    target: s.target ?? null,
    rule: s.rule
  }))
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function validGoal(g: unknown): g is LiftGoal {
  const x = g as LiftGoal
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof x.id === 'string' &&
    x.id.length > 0 &&
    x.id.length <= 40 &&
    typeof x.label === 'string' &&
    x.label.trim().length > 0 &&
    x.label.length <= 60 &&
    (x.exercise === null || (typeof x.exercise === 'string' && x.exercise.length <= 120)) &&
    ['e1rm', 'reps', 'seconds'].includes(x.metric) &&
    Array.isArray(x.regions) &&
    x.regions.every((r) => (BODY_REGIONS as readonly string[]).includes(r)) &&
    DATE.test(x.startDate) &&
    DATE.test(x.deadline) &&
    x.deadline > x.startDate &&
    (x.baseline === null || (typeof x.baseline === 'number' && isFinite(x.baseline) && x.baseline >= 0 && x.baseline < 10_000)) &&
    (x.target === null || (typeof x.target === 'number' && isFinite(x.target) && x.target > 0 && x.target < 10_000)) &&
    typeof x.rule === 'object' &&
    x.rule !== null &&
    (x.rule.pct == null || (typeof x.rule.pct === 'number' && x.rule.pct > 0 && x.rule.pct <= 200)) &&
    (x.rule.add == null || (typeof x.rule.add === 'number' && x.rule.add > 0 && x.rule.add <= 1000))
  )
}

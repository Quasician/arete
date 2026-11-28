import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays } from '../src/shared/logic.ts'
import { liftHistories } from '../src/shared/progress.ts'
import { goalProgress, guessExercise, regionProgress, roundTarget, suggestedGoals, validGoal, type LiftGoal } from '../src/shared/goals.ts'
import { findWins } from '../src/shared/wins.ts'
import { mapHevyWorkout } from '../src/main/sync/map.ts'
import type { Activity, LiftSummary } from '../src/shared/types.ts'

let id = 1
function session(date: string, lifts: Partial<LiftSummary>[]): Activity {
  return {
    id: id++, kind: 'lift', source: 'hevy', externalId: String(id), date, startedAt: null, title: null, durationSec: 3600,
    distanceM: null,
    detail: { lifts: lifts.map((l) => ({ name: 'X', templateId: null, sets: 3, bestE1rmKg: null, topWeightKg: null, bestReps: 0, ...l })) }
  }
}

const START = '2026-12-01'
const DEADLINE = '2027-02-28'
const acts: Activity[] = [
  session('2026-11-10', [{ name: 'Bench Press (Dumbbell)', bestE1rmKg: 30 }, { name: 'Pull Up', bestReps: 8 }]),
  session('2026-11-24', [{ name: 'Bench Press (Dumbbell)', bestE1rmKg: 31 }, { name: 'Pull Up', bestReps: 9 }, { name: 'Dead Hang', bestSeconds: 35 }]),
  session('2026-10-01', [{ name: 'Bench Press (Dumbbell)', bestE1rmKg: 33 }]), // older than four weeks: not the baseline
  session('2026-12-15', [{ name: 'Bench Press (Dumbbell)', bestE1rmKg: 32.5 }, { name: 'Pull Up', bestReps: 10 }]),
  session('2027-01-20', [{ name: 'Bench Press (Dumbbell)', bestE1rmKg: 33 }, { name: 'Pull Up', bestReps: 12 }, { name: 'Dead Hang', bestSeconds: 61 }])
]
const histories = liftHistories(acts)

test('suggested goals find the Hevy exercises and set raw targets', () => {
  const goals = suggestedGoals(histories, START, DEADLINE, () => `g${id++}`)
  assert.deepEqual(goals.map((g) => g.exercise), ['Bench Press (Dumbbell)', null, null, 'Pull Up', 'Dead Hang', null])
  const [bench, , , pull, hang] = goals.map((g) => goalProgress(g, histories, '2026-12-20', 'lb'))
  assert.equal(bench.baseline, 31)
  // 31 kg + 10% = 34.1 kg, rounded to a whole pound (75 lb).
  assert.ok(Math.abs(bench.target! - 75 * 0.45359237) < 1e-6)
  assert.equal(pull.baseline, 9)
  assert.equal(pull.target, 12)
  assert.equal(hang.baseline, 35)
  assert.equal(hang.target, 60)
  assert.equal(bench.best?.value, 32.5)
  assert.ok(bench.progress > 0.3 && bench.progress < 0.5)
})

test('with nothing in the last four weeks, the baseline is the most recent session', () => {
  const rdl: LiftGoal = { id: 'r', label: 'RDL', exercise: 'Romanian Deadlift (Dumbbell)', metric: 'e1rm', regions: ['hamstrings'], startDate: START, deadline: DEADLINE, baseline: null, target: null, rule: { pct: 10 } }
  const h = liftHistories([session('2026-10-14', [{ name: 'Romanian Deadlift (Dumbbell)', bestE1rmKg: 46 }]), session('2026-10-28', [{ name: 'Romanian Deadlift (Dumbbell)', bestE1rmKg: 57.5 }])])
  const p = goalProgress(rdl, h, '2026-12-02', 'lb')
  assert.equal(p.baseline, 57.5)
  assert.ok(Math.abs(p.target! - 139 * 0.45359237) < 1e-6)
})

test('goal status follows pace, and reaching it is a win', () => {
  const pull: LiftGoal = { id: 'p', label: 'Pull-ups', exercise: 'Pull Up', metric: 'reps', regions: ['upperBack', 'biceps'], startDate: START, deadline: DEADLINE, baseline: null, target: null, rule: { add: 3 } }
  const early = goalProgress(pull, histories, '2026-12-20', 'lb')
  assert.equal(early.status, 'ahead') // 1 of 3 extra reps three weeks in
  const done = goalProgress(pull, histories, '2027-01-25', 'lb')
  assert.equal(done.status, 'reached')
  assert.equal(done.reachedOn, '2027-01-20')
  assert.equal(done.progress, 1)
  const wins = findWins(acts, [], [], (kg) => `${kg} kg`, '2027-01-01', [done])
  assert.ok(wins.some((w) => w.title === 'Goal reached: Pull-ups'))
  const late = goalProgress({ ...pull, target: 20 }, histories, '2027-02-20', 'lb')
  assert.equal(late.status, 'behind')
  const missing = goalProgress({ ...pull, exercise: null }, histories, '2027-01-25', 'lb')
  assert.equal(missing.status, 'no-exercise')
})

test('body regions average the goals that train them', () => {
  const g = (id: string, exercise: string, metric: LiftGoal['metric'], regions: LiftGoal['regions'], target: number): LiftGoal => ({
    id, label: id, exercise, metric, regions, startDate: START, deadline: DEADLINE, baseline: null, target, rule: {}
  })
  const p = [
    goalProgress(g('pull', 'Pull Up', 'reps', ['upperBack', 'forearms'], 12), histories, '2027-01-25', 'lb'),
    goalProgress(g('hang', 'Dead Hang', 'seconds', ['forearms'], 120), histories, '2027-01-25', 'lb')
  ]
  const regions = regionProgress(p)
  assert.equal(regions.get('upperBack')!.value, 1)
  // Forearms: pull-ups done (1), hang from 35 s to 61 s of 120 s (about 0.31).
  assert.ok(Math.abs(regions.get('forearms')!.value - (1 + 26 / 85) / 2) < 1e-6)
  assert.equal(regions.has('chest'), false)
})

test('targets round to useful steps and goals validate', () => {
  assert.equal(roundTarget(12.4, 'reps', 'lb'), 12)
  assert.equal(roundTarget(62, 'seconds', 'lb'), 60)
  assert.equal(roundTarget(34.1, 'e1rm', 'kg'), 34)
  assert.equal(guessExercise([/romanian|\brdl\b/i], 'e1rm', histories), null)
  const ok: LiftGoal = { id: 'a', label: 'Bench', exercise: null, metric: 'e1rm', regions: ['chest'], startDate: START, deadline: DEADLINE, baseline: null, target: null, rule: { pct: 10 } }
  assert.equal(validGoal(ok), true)
  assert.equal(validGoal({ ...ok, deadline: '2026-11-01' }), false)
  assert.equal(validGoal({ ...ok, regions: ['wings'] }), false)
})

test('Hevy timed sets are kept for holds', () => {
  const row = mapHevyWorkout({
    id: 'w1', start_time: '2026-12-01T17:00:00Z', end_time: '2026-12-01T18:00:00Z',
    exercises: [{ title: 'Dead Hang', sets: [{ duration_seconds: 42 }, { duration_seconds: 48.4 }] }]
  })!
  assert.equal(row.detail.lifts![0].bestSeconds, 48)
  assert.equal(row.detail.liftsVersion, 3)
  assert.equal(liftHistories([{ ...session('2026-12-01', []), detail: row.detail }])[0].points[0].bestSeconds, 48)
  void addDays
})

test('exercises only in your routines can be picked before they are logged', async () => {
  const { exerciseForLabel } = await import('../src/shared/goals.ts')
  const goals = suggestedGoals([], START, DEADLINE, () => `x${id++}`, ['Dead Hang', 'Deep Squat Hold', 'Pull Up'])
  assert.deepEqual(goals.map((g) => g.exercise), [null, null, null, 'Pull Up', 'Dead Hang', 'Deep Squat Hold'])
  const hang: LiftGoal = { ...goals[4], exercise: null }
  assert.equal(exerciseForLabel(hang, [], ['Dead Hang']), 'Dead Hang')
  assert.equal(exerciseForLabel({ ...hang, label: 'Something else' }, [], ['Dead Hang']), null)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateOneRepMax } from '../src/shared/logic.ts'
import {
  estimateVo2Max,
  isTwoKTest,
  liftHistories,
  vo2Percentile,
  weeklyMinutes
} from '../src/shared/progress.ts'
import { mapHevyWorkout } from '../src/main/sync/map.ts'
import type { Activity } from '../src/shared/types.ts'

let id = 1
function act(date: string, kind: Activity['kind'], extra: Partial<Activity> = {}): Activity {
  return {
    id: id++, kind, source: 'manual', externalId: null, date, startedAt: null, title: null,
    durationSec: null, distanceM: null, detail: {}, ...extra
  }
}

test('estimateOneRepMax uses Epley and ignores high-rep sets', () => {
  assert.equal(estimateOneRepMax(100, 1), 100)
  assert.equal(estimateOneRepMax(30, 10), 40)
  assert.equal(estimateOneRepMax(30, 15), null)
  assert.equal(estimateOneRepMax(0, 8), null)
})

test('weeklyMinutes counts durations, fills in typical lengths and flags the rest', () => {
  const weeks = weeklyMinutes(
    [
      act('2026-11-23', 'lift', { durationSec: 3900 }),
      act('2026-11-24', 'walk'),
      act('2026-11-25', 'climb'),
      act('2026-11-16', 'row', { durationSec: 1500 })
    ],
    { walk: 30 },
    2,
    '2026-11-27'
  )
  assert.deepEqual(weeks, [
    { weekStart: '2026-11-16', measured: 25, estimated: 0, uncounted: 0 },
    { weekStart: '2026-11-23', measured: 65, estimated: 30, uncounted: 1 }
  ])
})

test('Hevy workouts keep per-exercise bests for the strength charts', () => {
  const row = mapHevyWorkout({
    id: 'w1',
    start_time: '2026-11-23T15:00:00Z',
    exercises: [
      { title: 'Bench Press (Dumbbell)', exercise_template_id: 't1', sets: [
        { type: 'warmup', weight_kg: 10, reps: 10 },
        { type: 'normal', weight_kg: 30, reps: 10 },
        { type: 'normal', weight_kg: 32.5, reps: 6 }
      ] },
      { title: 'Pull Up', sets: [{ type: 'normal', weight_kg: null, reps: 9 }, { type: 'normal', weight_kg: 0, reps: 7 }] }
    ]
  })!
  const [bench, pull] = row.detail.lifts!
  assert.equal(bench.sets, 2)
  assert.equal(bench.topWeightKg, 32.5)
  assert.equal(bench.bestE1rmKg, 40) // 30 x (1 + 10/30) beats 32.5 x 1.2 = 39
  assert.equal(pull.bestE1rmKg, null)
  assert.equal(pull.bestReps, 9)
})

test('liftHistories groups by exercise and marks bodyweight work as tracked by reps', () => {
  const lifts = (date: string, e1rm: number | null, reps: number) =>
    act(date, 'lift', { source: 'hevy', detail: { lifts: [
      { name: 'Goblet Squat', templateId: null, sets: 3, bestE1rmKg: e1rm, topWeightKg: e1rm, bestReps: reps },
      { name: 'Pull Up', templateId: null, sets: 3, bestE1rmKg: null, topWeightKg: null, bestReps: reps }
    ] } })
  const h = liftHistories([lifts('2026-11-20', 40, 8), lifts('2026-11-23', 42, 9)])
  assert.deepEqual(h.map((x) => [x.name, x.sessions, x.byReps]), [['Goblet Squat', 2, false], ['Pull Up', 2, true]])
  assert.deepEqual(h[0].points.map((p) => p.e1rmKg), [40, 42])
})

test('2k tests are recognised and converted with Concept2’s formula', () => {
  const twoK = act('2026-11-25', 'row', { distanceM: 2000, durationSec: 450, detail: { workoutType: 'FixedDistanceSplits' } })
  assert.equal(isTwoKTest(twoK), true)
  assert.equal(isTwoKTest({ ...twoK, detail: { workoutType: 'FixedDistanceInterval' } }), false)
  assert.equal(isTwoKTest({ ...twoK, distanceM: 6000, durationSec: 1500 }), false)
  // 7:30 at 84 kg: low level Y = 10.7 - 0.9 x 7.5 = 3.95 L/min -> 47.0 mL/kg/min
  assert.equal(Math.round(estimateVo2Max(450, 84, 'low') * 10) / 10, 47)
  // high level, over 75 kg: Y = 15.7 - 1.5 x 7.5 = 4.45 -> 53.0
  assert.equal(Math.round(estimateVo2Max(450, 84, 'high') * 10) / 10, 53)
})

test('vo2Percentile interpolates between FRIEND reference points', () => {
  assert.equal(vo2Percentile(48.0, '20-29'), 50)
  assert.equal(vo2Percentile(61.8, '20-29'), 90)
  assert.equal(vo2Percentile(70, '20-29'), 95)
  assert.equal(vo2Percentile(20, '20-29'), 5)
})

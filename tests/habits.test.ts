import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays } from '../src/shared/logic.ts'
import { REPETITION_RATE, doneLevel, habitStatus, recoverySuggestion, starterHabits, validHabit, type Habit } from '../src/shared/habits.ts'
import { reviewText, weeklyReview } from '../src/shared/review.ts'
import { findWins } from '../src/shared/wins.ts'
import type { Activity } from '../src/shared/types.ts'

let id = 1
function act(date: string, kind: Activity['kind'], minutes: number | null, extra: Partial<Activity> = {}): Activity {
  return { id: id++, kind, source: 'manual', externalId: null, date, startedAt: null, title: null, durationSec: minutes == null ? null : minutes * 60, distanceM: null, detail: {}, ...extra }
}

const row: Habit = {
  id: 'h1', name: 'Morning row', kind: 'row', days: [0, 1, 2, 3, 4, 5, 6], cue: 'After my alarm',
  time: '07:00', fullMinutes: 25, minimumMinutes: 5, startDate: '2026-11-01', active: true
}

test('66 repetitions take a habit to 95% strength', () => {
  assert.ok(Math.abs(1 - Math.pow(1 - REPETITION_RATE, 66) - 0.95) < 1e-9)
})

test('doneLevel tells full from minimum versions', () => {
  assert.equal(doneLevel(row, '2026-11-02', [act('2026-11-02', 'row', 26)]), 'full')
  assert.equal(doneLevel(row, '2026-11-02', [act('2026-11-02', 'row', 6)]), 'minimum')
  assert.equal(doneLevel(row, '2026-11-02', [act('2026-11-02', 'row', 10), act('2026-11-02', 'row', 15)]), 'full')
  assert.equal(doneLevel(row, '2026-11-02', [act('2026-11-02', 'lift', 60)]), 'none')
  assert.equal(doneLevel(row, '2026-11-02', [act('2026-11-02', 'row', null)]), 'full')
})

test('a single miss dips strength; it does not reset it', () => {
  const acts = Array.from({ length: 20 }, (_, i) => act(addDays('2026-11-01', i), 'row', 25))
  const before = habitStatus(row, acts, '2026-11-21')
  const withMiss = habitStatus(row, acts.filter((a) => a.date !== '2026-11-20'), '2026-11-21')
  assert.equal(before.repetitions, 20)
  assert.ok(withMiss.strength < before.strength)
  assert.ok(withMiss.strength > before.strength * 0.9)
  assert.equal(withMiss.missStreak, 1)
  assert.equal(withMiss.dontMissTwice, true)
  assert.equal(before.dontMissTwice, false)
})

test('today only counts as missed once the day is over', () => {
  const s = habitStatus(row, [act('2026-11-01', 'row', 25)], '2026-11-02')
  assert.equal(s.todayScheduled, true)
  assert.equal(s.todayLevel, 'none')
  assert.equal(s.missStreak, 0)
  assert.equal(s.repetitions, 1)
})

test('milestones are dated by the repetition that reached them', () => {
  const acts = Array.from({ length: 12 }, (_, i) => act(addDays('2026-11-01', i), 'row', 25))
  const s = habitStatus(row, acts, '2026-11-13')
  assert.deepEqual(s.milestones, [{ repetitions: 10, date: '2026-11-10' }])
})

test('two misses in a row suggest a recovery week', () => {
  const s = habitStatus(row, [act('2026-11-01', 'row', 25)], '2026-11-04')
  assert.equal(s.missStreak, 2)
  assert.match(recoverySuggestion([s])!, /Morning row has been missed 2 times in a row/)
})

test('starter habits follow the weekly plan', () => {
  const plan = [['lift'], ['lift'], ['row'], ['lift'], ['lift'], ['hike'], ['row']] as never
  let n = 0
  const habits = starterHabits(plan, '2026-11-27', () => `id${n++}`)
  assert.deepEqual(habits.find((h) => h.kind === 'row')!.days, [2, 6])
  assert.deepEqual(habits.find((h) => h.kind === 'lift')!.days, [0, 1, 3, 4])
  assert.ok(habits.every(validHabit))
  assert.equal(validHabit({ ...habits[0], minimumMinutes: 40 }), false)
})

test('weekly review flags a weekday that keeps slipping', () => {
  // Rowing every day for four weeks, except every Monday.
  const acts: Activity[] = []
  for (let i = 0; i < 28; i++) {
    const date = addDays('2026-11-02', i)
    if (i % 7 !== 0) acts.push(act(date, 'row', 25))
  }
  const r = weeklyReview([row], acts, '2026-11-23', '2026-11-29')
  assert.equal(r.habits[0].scheduled, 7)
  assert.equal(r.habits[0].full, 6)
  assert.equal(r.slipped, 'Morning row')
  assert.ok(r.suggestions.some((s) => /Mondays \(missed 4 of the last 4\)/.test(s)))
  assert.match(reviewText(r), /Morning row: 6\/7 kept/)
})

test('wins include lift records, habit milestones and new low weights', () => {
  const lifts = (date: string, e1rm: number) => act(date, 'lift', 60, { source: 'hevy', detail: { lifts: [{ name: 'Bench', templateId: null, sets: 3, bestE1rmKg: e1rm, topWeightKg: e1rm, bestReps: 5 }] } })
  const acts = [lifts('2026-11-01', 40), lifts('2026-11-04', 41), lifts('2026-11-08', 43)]
  const trend = Array.from({ length: 50 }, (_, i) => ({ date: addDays('2026-10-01', i), value: 83 - i * 0.05 }))
  const status = habitStatus(row, Array.from({ length: 10 }, (_, i) => act(addDays('2026-11-01', i), 'row', 25)), '2026-11-11')
  const wins = findWins(acts, trend, [status], (kg) => `${kg.toFixed(1)} kg`, '2026-11-01')
  assert.ok(wins.some((w) => w.id === 'e1rm:Bench:2026-11-08'))
  assert.ok(!wins.some((w) => w.id === 'e1rm:Bench:2026-11-04')) // needs two earlier sessions
  assert.ok(wins.some((w) => w.id === 'habit:h1:10'))
  assert.ok(wins.some((w) => w.id === 'weight:80'))
})

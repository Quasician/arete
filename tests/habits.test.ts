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

// ---------- stages, formed and the queue ----------

import { ATTENTION_STRENGTH, FORMED_STRENGTH, queueAdvice, repetitionsBetween, setActive } from '../src/shared/habits.ts'

const daily: Habit = { ...row, id: 'daily', name: 'Meditation', kind: 'meditate', fullMinutes: 10, minimumMinutes: 2 }
const every = (from: string, n: number, kind: Activity['kind'] = 'meditate') =>
  Array.from({ length: n }, (_, i) => act(addDays(from, i), kind, null))

test('stages move from starting to formed', () => {
  assert.equal(habitStatus(daily, every('2026-11-01', 3), '2026-11-04').stage, 'starting')
  assert.equal(habitStatus(daily, every('2026-11-01', 15), '2026-11-16').stage, 'building')
  assert.equal(habitStatus(daily, every('2026-11-01', 30), '2026-12-01').stage, 'sticking')
  const s = habitStatus(daily, every('2026-11-01', 60), addDays('2026-11-01', 60))
  assert.equal(s.stage, 'formed')
  // 90% strength takes 51 repetitions in a row.
  assert.equal(repetitionsBetween(0, FORMED_STRENGTH), 51)
  assert.equal(s.formedOn, addDays('2026-11-01', 50))
  assert.equal(s.toFormed, 0)
})

test('formed needs steady weeks, not just a count', () => {
  // Strong from a long streak, but most of the last four weeks missed: never formed in that run.
  const acts = [...every('2026-11-01', 45), ...every(addDays('2026-11-01', 45), 30).filter((_, i) => i % 3 === 0)]
  const s = habitStatus(daily, acts, addDays('2026-11-01', 75))
  assert.ok(s.repetitions >= 51)
  assert.equal(s.formedOn, null)
  assert.notEqual(s.stage, 'formed')
})

test('a formed habit that slips stays formed but needs attention', () => {
  const s = habitStatus(daily, every('2026-11-01', 60), addDays('2026-11-01', 66))
  assert.ok(s.formedOn)
  assert.equal(s.stage, 'formed')
  assert.ok(s.strength < ATTENTION_STRENGTH)
  assert.equal(s.needsAttention, true)
})

test('pausing keeps history; the paused days are not misses', () => {
  const acts = every('2026-11-01', 10)
  const paused = setActive(daily, false, '2026-11-11')
  const s = habitStatus(paused, acts, '2026-11-25')
  assert.equal(s.repetitions, 10)
  assert.equal(s.missStreak, 0)
  const resumed = setActive(paused, true, '2026-11-20')
  assert.deepEqual(resumed.pauses, [{ from: '2026-11-11', to: '2026-11-20' }])
  const r = habitStatus(resumed, acts, '2026-11-22')
  assert.equal(r.repetitions, 10)
  assert.equal(r.missStreak, 2) // 20th and 21st missed after resuming
})

test('the queue waits until the newest habit has held two weeks at 80%', () => {
  const walk = { ...daily, id: 'w', name: 'Daily walk', kind: 'walk' as const, startDate: '2026-11-01' }
  const med = { ...daily, startDate: '2026-11-20' }
  const statusesAt = (today: string, acts: Activity[]) => [habitStatus(walk, acts, today), habitStatus(med, acts, today)]
  const walks = every('2026-11-01', 40, 'walk')
  // Meditation is the newest; one week in, not yet.
  let advice = queueAdvice(statusesAt('2026-11-27', [...walks, ...every('2026-11-20', 7)]), '2026-11-27')
  assert.equal(advice.ready, false)
  assert.equal(advice.newest?.habit.name, 'Meditation')
  // Two weeks in, kept 10 of 14: not yet.
  const spotty = every('2026-11-20', 14).filter((_, i) => i % 4 !== 1)
  advice = queueAdvice(statusesAt('2026-12-04', [...walks, ...spotty]), '2026-12-04')
  assert.equal(advice.ready, false)
  assert.match(advice.reason, /10 of 14/)
  // Kept 13 of 14: ready.
  advice = queueAdvice(statusesAt('2026-12-04', [...walks, ...every('2026-11-20', 14).filter((_, i) => i !== 5)]), '2026-12-04')
  assert.equal(advice.ready, true)
  // A habit that starts in the future holds the queue.
  const art = { ...daily, id: 'a', name: 'Art', kind: 'art' as const, startDate: '2027-01-05' }
  advice = queueAdvice([habitStatus(art, [], '2026-12-04'), ...statusesAt('2026-12-04', walks)], '2026-12-04')
  assert.equal(advice.ready, false)
  assert.match(advice.reason, /Art starts Jan 5/)
})

test('formed habits are announced as wins', () => {
  const s = habitStatus(daily, every('2026-11-01', 60), addDays('2026-11-01', 60))
  const wins = findWins([], [], [s], (kg) => `${kg} kg`, '2026-11-01')
  assert.ok(wins.some((w) => w.id === 'formed:daily' && w.title === 'Meditation is formed'))
})

test('a habit that starts later has no misses and no stray days', () => {
  const art = { ...daily, id: 'a', name: 'Art', kind: 'art' as const, days: [1, 4], startDate: '2027-01-05' }
  const s = habitStatus(art, [], '2026-11-27')
  assert.equal(s.stage, 'upcoming')
  assert.equal(s.missStreak, 0)
  assert.equal(s.days.length, 28)
  assert.ok(s.days.every((d) => d.date <= '2026-11-27' && !d.scheduled))
})

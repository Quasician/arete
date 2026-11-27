import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addDays,
  buildWeek,
  dailyMeans,
  emptyPlan,
  formatPace,
  programWeek,
  rollingAverage,
  weekStartOf
} from '../src/shared/logic.ts'
import type { Activity } from '../src/shared/types.ts'

test('weekStartOf returns the Monday of the week', () => {
  assert.equal(weekStartOf('2026-11-27'), '2026-11-23') // Friday
  assert.equal(weekStartOf('2026-11-23'), '2026-11-23') // Monday
  assert.equal(weekStartOf('2026-11-29'), '2026-11-23') // Sunday
  assert.equal(weekStartOf('2027-01-01'), '2026-12-28') // across a year boundary
})

test('addDays handles month and leap-year boundaries', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
})

test('programWeek counts weeks from the start and stops after the last one', () => {
  const program = { name: 'Rowing', start: '2026-10-26', weeks: 12, kind: 'row' as const }
  assert.equal(programWeek(program, '2026-10-25'), null)
  assert.equal(programWeek(program, '2026-10-26'), 1)
  assert.equal(programWeek(program, '2026-11-01'), 1)
  assert.equal(programWeek(program, '2026-11-02'), 2)
  assert.equal(programWeek(program, '2027-01-17'), 12)
  assert.equal(programWeek(program, '2027-01-18'), null)
  assert.equal(programWeek(null, '2026-11-02'), null)
})

function activity(date: string, kind: Activity['kind']): Activity {
  return {
    id: Math.random(),
    kind,
    source: 'manual',
    externalId: null,
    date,
    startedAt: null,
    title: null,
    durationSec: null,
    distanceM: null,
    detail: {}
  }
}

test('buildWeek matches planned sessions against what happened', () => {
  const plan = emptyPlan()
  plan[0] = ['lift', 'walk'] // Monday
  plan[2] = ['row'] // Wednesday
  const week = buildWeek(
    '2026-11-23',
    plan,
    [activity('2026-11-23', 'lift'), activity('2026-11-25', 'climb'), activity('2026-11-30', 'row')],
    null
  )
  assert.equal(week.days.length, 7)
  assert.deepEqual(week.days[0].plannedDone, ['lift'])
  assert.deepEqual(week.days[2].plannedDone, [])
  assert.equal(week.days[2].activities.length, 1) // the unplanned climb still shows
  assert.equal(week.plannedCount, 3)
  assert.equal(week.plannedDoneCount, 1)
  assert.equal(week.program, null)
})

test('buildWeek reports the program week', () => {
  const week = buildWeek('2026-11-23', emptyPlan(), [], {
    name: 'Rowing',
    start: '2026-10-26',
    weeks: 12,
    kind: 'row'
  })
  assert.deepEqual(week.program, { name: 'Rowing', week: 5, total: 12, kind: 'row' })
})

test('rollingAverage uses calendar days, not entries', () => {
  const out = rollingAverage(
    [
      { date: '2026-11-01', value: 80 },
      { date: '2026-11-02', value: 82 },
      { date: '2026-11-10', value: 78 } // more than 7 days later: earlier entries drop out
    ],
    7
  )
  assert.deepEqual(
    out.map((p) => p.value),
    [80, 81, 78]
  )
})

test('dailyMeans averages several weigh-ins on the same day', () => {
  assert.deepEqual(
    dailyMeans([
      { date: '2026-11-02', value: 81 },
      { date: '2026-11-01', value: 80 },
      { date: '2026-11-02', value: 83 }
    ]),
    [
      { date: '2026-11-01', value: 80 },
      { date: '2026-11-02', value: 82 }
    ]
  )
})

test('formatPace formats rowing splits without rounding to :60', () => {
  assert.equal(formatPace(125), '2:05.0 /500m')
  assert.equal(formatPace(119.96), '2:00.0 /500m')
  assert.equal(formatPace(undefined), '')
})

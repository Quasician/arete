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

import { morningTrend, readingHour } from '../src/shared/logic.ts'
import type { WeightEntry } from '../src/shared/types.ts'

let nextId = 1
function w(date: string, time: string, kg: number): WeightEntry {
  return { id: nextId++, date, measuredAt: `${date}T${time}`, kg, fatPct: null, source: 'withings' }
}

test('readingHour reads local Withings times and UTC timestamps', () => {
  assert.equal(readingHour('2026-11-25T07:02:11'), 7)
  assert.equal(readingHour('2026-11-25T22:40:00'), 22)
  assert.equal(readingHour(new Date(2026, 10, 25, 6, 30).toISOString()), 6)
})

test('morningTrend uses morning weigh-ins and ignores raw evening ones', () => {
  const t = morningTrend(
    [w('2026-11-01', '07:00:00', 80), w('2026-11-01', '22:00:00', 81.2), w('2026-11-02', '06:45:00', 79.8)],
    7
  )
  assert.deepEqual(
    t.daily.map((p) => [p.date, p.value, p.estimated]),
    [
      ['2026-11-01', 80, false],
      ['2026-11-02', 79.8, false]
    ]
  )
  assert.equal(t.gapKg, null) // only one day with both readings so far
})

test('morningTrend learns the evening gain and estimates mornings from evening-only days', () => {
  const entries = [
    w('2026-11-01', '07:00:00', 80.0), w('2026-11-01', '22:00:00', 81.0), // +1.0
    w('2026-11-02', '07:00:00', 80.2), w('2026-11-02', '21:30:00', 81.4), // +1.2
    w('2026-11-03', '07:10:00', 80.0), w('2026-11-03', '22:15:00', 80.8), // +0.8
    w('2026-11-04', '22:00:00', 81.1) // evening only
  ]
  const t = morningTrend(entries, 7)
  assert.equal(Math.round(t.gapKg! * 100) / 100, 1.0)
  assert.equal(t.pairedDays, 3)
  const last = t.daily.at(-1)!
  assert.equal(last.date, '2026-11-04')
  assert.equal(last.estimated, true)
  assert.equal(Math.round(last.value * 100) / 100, 80.1)
})

test('morningTrend takes the first morning reading when there are several', () => {
  const t = morningTrend([w('2026-11-05', '09:30:00', 80.6), w('2026-11-05', '06:50:00', 80.1)], 7)
  assert.equal(t.daily[0].value, 80.1)
})

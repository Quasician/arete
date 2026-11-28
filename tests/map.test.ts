import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapConcept2Result, mapHevyWorkout } from '../src/main/sync/map.ts'

test('mapHevyWorkout counts working sets and volume, skipping warm-ups', () => {
  const row = mapHevyWorkout({
    id: 'abc',
    title: 'Upper A',
    start_time: '2026-11-23T15:00:00Z',
    end_time: '2026-11-23T16:05:30Z',
    exercises: [
      {
        title: 'Bench Press (Dumbbell)',
        sets: [
          { type: 'warmup', weight_kg: 10, reps: 10 },
          { type: 'normal', weight_kg: 30, reps: 8 },
          { type: 'normal', weight_kg: 30, reps: 7 }
        ]
      },
      { title: 'Pull Up', sets: [{ type: 'normal', weight_kg: null, reps: 8 }] }
    ]
  })
  assert.ok(row)
  assert.equal(row.kind, 'lift')
  assert.equal(row.source, 'hevy')
  assert.equal(row.externalId, 'abc')
  assert.equal(row.durationSec, 3930)
  assert.equal(row.detail.exercises, 2)
  assert.equal(row.detail.sets, 3)
  assert.equal(row.detail.volumeKg, 450)
  assert.equal(row.detail.lifts?.length, 2)
})

test('mapHevyWorkout rejects records without an id or start time', () => {
  assert.equal(mapHevyWorkout({ id: '', start_time: '2026-11-23T15:00:00Z' }), null)
  assert.equal(mapHevyWorkout({ id: 'x', start_time: null }), null)
  assert.equal(mapHevyWorkout({ id: 'x', start_time: 'not a date' }), null)
})

test('mapConcept2Result converts tenths of a second and computes the split', () => {
  const row = mapConcept2Result({
    id: 987,
    date: '2026-11-25 07:02:00',
    date_utc: '2026-11-25 15:02:00',
    type: 'rower',
    distance: 6000,
    time: 15000, // 25:00.0
    workout_type: 'FixedTimeSplits',
    stroke_rate: 22,
    heart_rate: { average: 141 }
  })
  assert.ok(row)
  assert.equal(row.kind, 'row')
  assert.equal(row.externalId, '987')
  assert.equal(row.date, '2026-11-25')
  assert.equal(row.durationSec, 1500)
  assert.equal(row.distanceM, 6000)
  assert.equal(row.detail.paceSecPer500, 125)
  assert.equal(row.detail.avgHeartRate, 141)
  assert.equal(row.title, 'Fixed Time Splits')
  assert.equal(row.startedAt, '2026-11-25T15:02:00.000Z')
})

test('mapConcept2Result maps other machines to "other" and rejects bad dates', () => {
  assert.equal(mapConcept2Result({ id: 1, date: '2026-11-25 07:00:00', type: 'bike' })?.kind, 'other')
  assert.equal(mapConcept2Result({ id: 2, date: 'yesterday' }), null)
  assert.equal(mapConcept2Result({ id: 3 }), null)
})

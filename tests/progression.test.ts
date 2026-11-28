import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  DEFAULT_STEP_KG,
  LB,
  latestPerformance,
  planRoutines,
  progressExercise,
  sessionsToTarget,
  type Performed,
  type RoutineExercise
} from '../src/shared/progression.ts'
import { mapHevyWorkout } from '../src/main/sync/map.ts'

const lb = (n: number) => n * LB
const bench: RoutineExercise = {
  title: 'Bench Press (Dumbbell)', exercise_template_id: 'bench', superset_id: null, rest_seconds: 120, notes: 'Pause at the bottom',
  sets: [
    { type: 'warmup', weight_kg: lb(60), reps: 10 },
    { type: 'normal', weight_kg: lb(120), reps: 8 },
    { type: 'normal', weight_kg: lb(120), reps: 8 },
    { type: 'normal', weight_kg: lb(120), reps: 8 }
  ]
}
const did = (w: number, reps: number[]): Performed => ({ date: '2026-11-30', sets: reps.map((r) => ({ kg: lb(w), reps: r, sec: null })) })

test('same weight, one more rep, until every set hits the top', () => {
  const p = progressExercise(bench, did(120, [8, 8, 7]), [6, 10], DEFAULT_STEP_KG)!
  const work = p.sets.filter((s) => s.type !== 'warmup')
  assert.ok(work.every((s) => Math.abs(s.weight_kg! - lb(120)) < 0.01 && s.reps === 8 && s.rep_range?.start === 6))
  // The warm-up set is untouched.
  assert.deepEqual(p.sets[0], bench.sets[0])
})

test('every set at the top: one 5 lb step heavier, back to the bottom', () => {
  const p = progressExercise(bench, did(120, [10, 10, 10]), [6, 10], DEFAULT_STEP_KG)!
  const work = p.sets.filter((s) => s.type !== 'warmup')
  assert.ok(work.every((s) => Math.abs(s.weight_kg! / LB - 125) < 0.01 && s.reps === 6))
  assert.match(p.why, /heavier/)
})

test("nothing moves until the planned weight has been lifted", () => {
  const planned125 = { ...bench, sets: bench.sets.map((s) => (s.type === 'normal' ? { ...s, weight_kg: lb(125) } : s)) }
  assert.equal(progressExercise(planned125, did(120, [10, 10, 10]), [6, 10], DEFAULT_STEP_KG), null)
})

test('a bad day under the range drops one step; bodyweight adds reps; holds add seconds', () => {
  const down = progressExercise(bench, did(120, [4, 4, 3]), [6, 10], DEFAULT_STEP_KG)!
  assert.ok(Math.abs(down.sets[1].weight_kg! / LB - 115) < 0.01)
  const pull: RoutineExercise = { ...bench, title: 'Pull Up', exercise_template_id: 'pull', sets: [{ type: 'normal', reps: 6 }, { type: 'normal', reps: 6 }] }
  const p = progressExercise(pull, { date: 'x', sets: [{ kg: null, reps: 6, sec: null }, { kg: null, reps: 5, sec: null }] }, [8, 12], DEFAULT_STEP_KG)!
  assert.deepEqual(p.sets.map((s) => s.reps), [6, 6])
  const p2 = progressExercise(pull, { date: 'x', sets: [{ kg: null, reps: 7, sec: null }, { kg: null, reps: 6, sec: null }] }, [8, 12], DEFAULT_STEP_KG)!
  assert.deepEqual(p2.sets.map((s) => s.reps), [7, 7])
  const hang: RoutineExercise = { ...bench, title: 'Dead Hang', exercise_template_id: 'hang', sets: [{ type: 'normal', duration_seconds: 30 }] }
  const h = progressExercise(hang, { date: 'x', sets: [{ kg: null, reps: null, sec: 38 }] }, [8, 12], DEFAULT_STEP_KG)!
  assert.equal(h.sets[0].duration_seconds, 45)
})

test('planRoutines only returns routines that change, with a readable list', () => {
  const routines = [
    { id: 'u1', title: 'Upper 1', notes: null, exercises: [bench] },
    { id: 'l1', title: 'Lower 1', notes: null, exercises: [{ ...bench, title: 'Squat', exercise_template_id: 'squat' }] }
  ]
  const perf = new Map([['bench', did(120, [10, 10, 10])]])
  const { routines: out, changes } = planRoutines(routines, perf, () => [6, 10], DEFAULT_STEP_KG, (kg) => `${Math.round(kg / LB)} lb`)
  assert.equal(out.length, 1)
  assert.equal(changes[0].from, '3 × 8 @ 120 lb')
  assert.equal(changes[0].to, '3 × 6 (6–10) @ 125 lb')
})

test('latest performance comes from the newest Hevy session of each exercise', () => {
  const w = (id: string, date: string, reps: number) =>
    mapHevyWorkout({ id, start_time: `${date}T17:00:00Z`, exercises: [{ title: 'Bench', exercise_template_id: 'bench', sets: [{ type: 'warmup', weight_kg: 20, reps: 10 }, { weight_kg: 54.43, reps }] }] })!
  const acts = [w('a', '2026-11-09', 8), w('b', '2026-11-30', 9)].map((r, i) => ({ id: i, ...r }))
  const p = latestPerformance(acts as never).get('bench')!
  assert.equal(p.date, '2026-11-30')
  assert.deepEqual(p.sets, [{ kg: 54.43, reps: 9, sec: null }])
})

test('a rep a session reaches the bench goal in eleven sessions', () => {
  // 120 lb x 8 now, target 167 lb estimated one-rep max.
  assert.equal(sessionsToTarget(lb(120), 8, lb(167), [6, 10], DEFAULT_STEP_KG), 11)
})

test('routine updates copy everything back, changing only targets', async () => {
  let put: { url?: string; body?: any } = {}
  const routine = {
    id: 'u1', title: 'Upper 1', notes: 'Week A', folder_id: 3, updated_at: 'x', created_at: 'y',
    exercises: [
      { index: 1, title: 'Row', rest_seconds: '90', notes: '', exercise_template_id: 'row', supersets_id: 2, sets: [{ index: 0, type: 'normal', weight_kg: 30, reps: 10, rpe: null, rep_range: { start: 8, end: 12 } }] },
      { index: 0, title: 'Bench Press (Dumbbell)', rest_seconds: '120', notes: 'Pause', exercise_template_id: 'bench', supersets_id: null,
        sets: [{ index: 1, type: 'normal', weight_kg: lb(120), reps: 8, rpe: null }, { index: 0, type: 'warmup', weight_kg: lb(60), reps: 10, rpe: null }] }
    ]
  }
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      assert.equal(req.headers['api-key'], 'k')
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ page: 1, page_count: 1, routines: [routine] }))
      }
      put = { url: req.url, body: JSON.parse(body) }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  process.env['ARETE_HEVY_BASE'] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const { listRoutines, updateRoutine } = await import('../src/main/sync/hevyRoutines.ts')
    const { routines } = await listRoutines('k')
    assert.deepEqual(routines[0].exercises.map((e) => e.title), ['Bench Press (Dumbbell)', 'Row'])
    assert.equal(routines[0].exercises[0].sets[0].type, 'warmup')
    const plan = planRoutines(routines, new Map([['bench', did(120, [10, 10])]]), () => [6, 10], DEFAULT_STEP_KG, String)
    await updateRoutine('k', plan.routines[0])
    assert.equal(put.url, '/v1/routines/u1')
    const r = put.body.routine
    assert.equal(r.title, 'Upper 1')
    assert.equal(r.notes, 'Week A')
    assert.equal(r.folder_id, undefined)
    assert.deepEqual(r.exercises.map((e: any) => [e.exercise_template_id, e.rest_seconds, e.superset_id, e.notes]), [['bench', 120, null, 'Pause'], ['row', 90, 2, '']])
    assert.deepEqual(r.exercises[0].sets[0], { type: 'warmup', weight_kg: lb(60), reps: 10, distance_meters: null, duration_seconds: null, custom_metric: null, rep_range: null })
    assert.ok(Math.abs(r.exercises[0].sets[1].weight_kg / LB - 125) < 0.01)
    assert.equal(r.exercises[0].sets[1].reps, 6)
    // The row is copied back exactly, with no index or rpe.
    assert.deepEqual(r.exercises[1].sets[0], { type: 'normal', weight_kg: 30, reps: 10, distance_meters: null, duration_seconds: null, custom_metric: null, rep_range: { start: 8, end: 12 } })
  } finally {
    server.close()
  }
})

test('warm-ups and stretching are never progressed; mixed-length holds are drills', () => {
  const warm: RoutineExercise = { ...bench, title: 'Warm Up', exercise_template_id: 'w', sets: [{ type: 'normal', duration_seconds: 60 }, { type: 'normal', duration_seconds: 45 }] }
  assert.equal(progressExercise(warm, { date: 'x', sets: [{ kg: null, reps: null, sec: 237 }] }, [8, 12], DEFAULT_STEP_KG), null)
  const stretch: RoutineExercise = { ...warm, title: 'Stretching', sets: [{ type: 'normal', duration_seconds: 60 }, { type: 'normal', duration_seconds: 60 }] }
  assert.equal(progressExercise(stretch, { date: 'x', sets: [{ kg: null, reps: null, sec: 60 }] }, [8, 12], DEFAULT_STEP_KG), null)
  const plank: RoutineExercise = { ...warm, title: 'Plank', sets: [{ type: 'normal', duration_seconds: 45 }, { type: 'normal', duration_seconds: 49 }] }
  assert.equal(progressExercise(plank, { date: 'x', sets: [{ kg: null, reps: null, sec: 50 }] }, [8, 12], DEFAULT_STEP_KG), null)
})

test('ramped sets keep their spacing', () => {
  const ramp: RoutineExercise = {
    ...bench,
    sets: [
      { type: 'warmup', weight_kg: lb(60), reps: 8 },
      { type: 'normal', weight_kg: lb(100), reps: 8 },
      { type: 'normal', weight_kg: lb(120), reps: 8 }
    ]
  }
  const done: Performed = { date: 'x', sets: [{ kg: lb(100), reps: 10, sec: null }, { kg: lb(120), reps: 10, sec: null }] }
  const up = progressExercise(ramp, done, [6, 10], DEFAULT_STEP_KG)!
  assert.deepEqual(up.sets.map((s) => Math.round(s.weight_kg! / LB)), [60, 105, 125])
  const hold = progressExercise(ramp, { date: 'x', sets: [{ kg: lb(100), reps: 9, sec: null }, { kg: lb(120), reps: 8, sec: null }] }, [6, 10], DEFAULT_STEP_KG)!
  assert.deepEqual(hold.sets.map((s) => Math.round(s.weight_kg! / LB)), [60, 100, 120])
  assert.deepEqual(hold.sets.slice(1).map((s) => s.reps), [9, 9])
  const { changes } = planRoutines([{ id: 'u', title: 'Upper A', notes: null, exercises: [ramp] }], new Map([['bench', done]]), () => [6, 10], DEFAULT_STEP_KG, (kg) => `${Math.round(kg / LB)} lb`)
  assert.equal(changes[0].to, '2 × 6 (6–10) @ 105 lb / 125 lb')
})

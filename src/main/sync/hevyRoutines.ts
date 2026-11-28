// Reads Hevy routines and writes new targets into them (Hevy API v1).
// PUT replaces a whole routine, so everything not being changed is copied
// back exactly: order, notes, rest times, supersets, warm-up sets.
import fs from 'node:fs'
import path from 'node:path'
import type { Routine, RoutineSet } from '../../shared/progression.ts'

const BASE = process.env['ARETE_HEVY_BASE'] || 'https://api.hevyapp.com'
const TIMEOUT_MS = 20_000

interface ApiSet extends RoutineSet {
  index?: number
  rpe?: number | null
}
interface ApiExercise {
  index?: number
  title: string
  exercise_template_id: string
  supersets_id?: number | null
  superset_id?: number | null
  rest_seconds?: string | number | null
  notes?: string | null
  sets: ApiSet[]
}
interface ApiRoutine {
  id: string
  title: string
  notes?: string | null
  exercises: ApiExercise[]
}

async function call<T>(key: string, method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'api-key': key, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) {
    if (res.status === 401) throw new Error('Hevy rejected the key. Check it in Settings.')
    // Hevy explains what it didn't accept; show that (it's Hevy's own message, not your data).
    let detail = ''
    try {
      const body = (await res.text()).replace(/\s+/g, ' ').trim()
      const parsed = (() => {
        try {
          const j = JSON.parse(body)
          return typeof j?.error === 'string' ? j.error : typeof j?.message === 'string' ? j.message : body
        } catch {
          return body
        }
      })()
      detail = parsed ? `: ${parsed.slice(0, 240)}` : ''
    } catch {
      // no body
    }
    throw new Error(`Hevy returned an error (${res.status})${detail}`)
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return typeof n === 'number' && isFinite(n) ? n : null
}

function fromApi(r: ApiRoutine): Routine {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes ?? null,
    exercises: [...(r.exercises ?? [])]
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((e) => ({
        title: e.title,
        exercise_template_id: e.exercise_template_id,
        superset_id: e.superset_id ?? e.supersets_id ?? null,
        rest_seconds: num(e.rest_seconds),
        notes: e.notes ?? null,
        sets: [...(e.sets ?? [])]
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
          .map((s) => ({
            type: s.type ?? 'normal',
            weight_kg: s.weight_kg ?? null,
            reps: s.reps ?? null,
            distance_meters: s.distance_meters ?? null,
            duration_seconds: s.duration_seconds ?? null,
            custom_metric: s.custom_metric ?? null,
            rep_range: s.rep_range ?? null
          }))
      }))
  }
}

export async function listRoutines(key: string): Promise<{ routines: Routine[]; raw: unknown[] }> {
  const routines: Routine[] = []
  const raw: unknown[] = []
  for (let page = 1; page <= 20; page++) {
    const data = await call<{ page_count?: number; routines?: ApiRoutine[] }>(key, 'GET', `/v1/routines?page=${page}&pageSize=10`)
    for (const r of data.routines ?? []) {
      raw.push(r)
      routines.push(fromApi(r))
    }
    if (page >= (data.page_count ?? 1) || !(data.routines ?? []).length) break
  }
  return { routines, raw }
}

/** Leaves out empty fields: Hevy rejects fields that don't fit the exercise type. */
function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as Partial<T>
}

/** The body for PUT /v1/routines/{id}. */
export function routineBody(r: Routine) {
  return {
    routine: compact({
      title: r.title,
      notes: r.notes || null,
      exercises: r.exercises.map((e) =>
        compact({
          exercise_template_id: e.exercise_template_id,
          superset_id: e.superset_id,
          rest_seconds: e.rest_seconds,
          notes: e.notes || null,
          sets: e.sets.map((s) =>
            compact({
              type: s.type,
              weight_kg: s.weight_kg,
              reps: s.reps,
              distance_meters: s.distance_meters,
              duration_seconds: s.duration_seconds,
              custom_metric: s.custom_metric,
              rep_range: s.rep_range
            })
          )
        })
      )
    })
  }
}

export async function updateRoutine(key: string, r: Routine): Promise<void> {
  await call(key, 'PUT', `/v1/routines/${encodeURIComponent(r.id)}`, routineBody(r))
}

/** Keeps a copy of the routines as Hevy returned them, before the first change of a day. */
export function backupRoutines(dir: string, raw: unknown[], today: string): void {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `hevy-routines-${today}.json`)
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(raw, null, 2))
  // Keep the last 20 backups.
  const old = fs.readdirSync(dir).filter((f) => f.startsWith('hevy-routines-')).sort().slice(0, -20)
  for (const f of old) fs.rmSync(path.join(dir, f))
}

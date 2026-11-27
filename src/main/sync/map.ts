// Turns Hevy and Concept2 API records into Arete activities. Kept free of
// network and database code so it can be tested on sample payloads.
import type { ActivityDetail, ActivityKind, ActivitySource } from '../../shared/types.ts'
import { toLocalDate } from '../../shared/logic.ts'

export interface ActivityRow {
  kind: ActivityKind
  source: ActivitySource
  externalId: string
  date: string
  startedAt: string | null
  title: string | null
  durationSec: number | null
  distanceM: number | null
  detail: ActivityDetail
}

// ---------- Hevy (https://api.hevyapp.com/docs) ----------

export interface HevySet {
  weight_kg?: number | null
  reps?: number | null
  type?: string | null
}

export interface HevyWorkout {
  id: string
  title?: string | null
  start_time?: string | null
  end_time?: string | null
  exercises?: { title?: string | null; sets?: HevySet[] | null }[] | null
}

export function mapHevyWorkout(w: HevyWorkout): ActivityRow | null {
  if (!w?.id || !w.start_time) return null
  const start = new Date(w.start_time)
  if (isNaN(start.getTime())) return null
  const end = w.end_time ? new Date(w.end_time) : null
  const exercises = w.exercises ?? []
  let sets = 0
  let volumeKg = 0
  for (const ex of exercises) {
    for (const s of ex.sets ?? []) {
      if (s.type === 'warmup') continue
      sets++
      if (s.weight_kg && s.reps) volumeKg += s.weight_kg * s.reps
    }
  }
  return {
    kind: 'lift',
    source: 'hevy',
    externalId: w.id,
    date: toLocalDate(start),
    startedAt: start.toISOString(),
    title: w.title ?? null,
    durationSec: end && !isNaN(end.getTime()) ? Math.round((end.getTime() - start.getTime()) / 1000) : null,
    distanceM: null,
    detail: { exercises: exercises.length, sets, volumeKg: Math.round(volumeKg) }
  }
}

// ---------- Concept2 Logbook (https://log.concept2.com/developers/documentation) ----------

export interface Concept2Result {
  id: number | string
  /** Local time of the workout, e.g. "2026-11-20 07:05:00". */
  date?: string | null
  date_utc?: string | null
  type?: string | null
  distance?: number | null
  /** Tenths of a second. */
  time?: number | null
  workout_type?: string | null
  stroke_rate?: number | null
  calories_total?: number | null
  heart_rate?: { average?: number | null } | null
}

function concept2Kind(type: string | null | undefined): ActivityKind {
  return type === 'rower' ? 'row' : 'other'
}

export function mapConcept2Result(r: Concept2Result): ActivityRow | null {
  if (r?.id == null || !r.date) return null
  // The logbook's "date" is already the rower's local time; take the calendar day as-is.
  const date = r.date.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const durationSec = r.time ? r.time / 10 : null
  const distanceM = r.distance ?? null
  const detail: ActivityDetail = {}
  if (durationSec && distanceM) detail.paceSecPer500 = durationSec / (distanceM / 500)
  if (r.heart_rate?.average) detail.avgHeartRate = r.heart_rate.average
  if (r.stroke_rate) detail.strokeRate = r.stroke_rate
  if (r.workout_type) detail.workoutType = r.workout_type
  if (r.calories_total) detail.calories = r.calories_total
  let startedAt: string | null = null
  if (r.date_utc) {
    const t = new Date(r.date_utc.replace(' ', 'T') + 'Z')
    if (!isNaN(t.getTime())) startedAt = t.toISOString()
  }
  return {
    kind: concept2Kind(r.type),
    source: 'concept2',
    externalId: String(r.id),
    date,
    startedAt,
    title: r.workout_type ? splitCamel(r.workout_type) : null,
    durationSec: durationSec ? Math.round(durationSec) : null,
    distanceM,
    detail
  }
}

function splitCamel(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1 $2')
}

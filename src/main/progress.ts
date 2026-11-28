// Runs the weekly progression: works out each exercise's next targets from its
// latest Hevy session and, when turned on, writes them into the Hevy routines.
import path from 'node:path'
import { toLocalDate, KG_PER_LB } from '../shared/logic.ts'
import {
  ACCESSORY_RANGE,
  MAIN_RANGE,
  latestPerformance,
  planRoutines,
  type Change,
  type RoutineExercise
} from '../shared/progression.ts'
import type { Repo } from './repo.ts'
import type { Settings } from './settings.ts'
import { backupRoutines, listRoutines, updateRoutine } from './sync/hevyRoutines.ts'
import { log } from './log.ts'

export interface ProgressionPlan {
  changes: Change[]
  routines: number
}

function show(settings: Settings) {
  const units = settings.public().units
  return (kg: number) => (units === 'lb' ? `${Math.round(kg / KG_PER_LB)} lb` : `${Math.round(kg * 10) / 10} kg`)
}

async function plan(settings: Settings, repo: Repo) {
  const key = settings.getSecret('hevy')
  if (!key) throw new Error('Add your Hevy API key in Settings first.')
  const { routines, raw } = await listRoutines(key)
  const goalExercises = new Set(settings.liftGoals.map((g) => g.exercise).filter(Boolean))
  const ranges = settings.progression.ranges
  const rangeFor = (ex: RoutineExercise) =>
    ranges[ex.exercise_template_id] ?? (goalExercises.has(ex.title) ? MAIN_RANGE : ACCESSORY_RANGE)
  const result = planRoutines(routines, latestPerformance(repo.allActivities()), rangeFor, settings.progression.stepKg, show(settings))
  log('progression plan', `${routines.length} routines`, `${result.changes.length} change(s) in ${result.routines.length}`)
  return { key, raw, all: routines, ...result }
}

/** What would change, without writing anything. */
export async function previewProgression(settings: Settings, repo: Repo): Promise<ProgressionPlan> {
  const p = await plan(settings, repo)
  return { changes: p.changes, routines: p.all.length }
}

/** Writes the new targets into Hevy. Returns what changed. */
export async function applyProgression(settings: Settings, repo: Repo, userData: string): Promise<Change[]> {
  const p = await plan(settings, repo)
  if (!p.changes.length) return []
  backupRoutines(path.join(userData, 'backups'), p.raw, toLocalDate(new Date()))
  const done: Change[] = []
  for (const r of p.routines) {
    try {
      await updateRoutine(p.key, r)
      log('progression updated routine', r.id, `${r.exercises.length} exercises`)
    } catch (err) {
      log('progression routine update FAILED', r.id, `${r.exercises.length} exercises`, err)
      if (done.length) settings.recordProgression(done)
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`${r.title} wasn't updated. ${msg}${done.length ? ` (${new Set(done.map((c) => c.routine)).size} routine(s) before it were.)` : ''}`)
    }
    done.push(...p.changes.filter((c) => c.routineId === r.id))
  }
  settings.recordProgression(done)
  return done
}

/** Every exercise in your Hevy routines, by name, including ones not logged yet. */
export async function routineExerciseNames(settings: Settings): Promise<string[]> {
  const key = settings.getSecret('hevy')
  if (!key) return []
  const { routines } = await listRoutines(key)
  return [...new Set(routines.flatMap((r) => r.exercises.map((e) => e.title)))].sort()
}

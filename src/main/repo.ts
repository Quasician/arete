// Reads and writes for activities, weights and meals.
import { and, asc, between, desc, eq } from 'drizzle-orm'
import type { Store } from './db.ts'
import { activities, meals, weights } from './schema.ts'
import { ACTIVITY_KINDS, MEAL_SLOTS } from '../shared/types.ts'
import type {
  Activity,
  ActivityDetail,
  ActivityKind,
  ActivitySource,
  Meal,
  MealSlot,
  NewActivity,
  NewMeal,
  NewWeight,
  Portion,
  WeightEntry
} from '../shared/types.ts'
import type { ActivityRow } from './sync/map.ts'

type ActivityRecord = typeof activities.$inferSelect
type WeightRecord = typeof weights.$inferSelect
type MealRecord = typeof meals.$inferSelect

function parseDetail(json: string): ActivityDetail {
  try {
    return JSON.parse(json) as ActivityDetail
  } catch {
    return {}
  }
}

function toActivity(r: ActivityRecord): Activity {
  return {
    id: r.id,
    kind: r.kind as ActivityKind,
    source: r.source as ActivitySource,
    externalId: r.externalId,
    date: r.date,
    startedAt: r.startedAt,
    title: r.title,
    durationSec: r.durationSec,
    distanceM: r.distanceM,
    detail: parseDetail(r.detail)
  }
}

function toWeight(r: WeightRecord): WeightEntry {
  return {
    id: r.id,
    date: r.date,
    measuredAt: r.measuredAt,
    kg: r.kg,
    fatPct: r.fatPct,
    source: r.source as WeightEntry['source']
  }
}

function toMeal(r: MealRecord): Meal {
  return {
    id: r.id,
    date: r.date,
    slot: r.slot as MealSlot,
    description: r.description,
    portion: r.portion as Portion,
    kcal: r.kcal,
    proteinG: r.proteinG,
    source: r.source as Meal['source']
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function assertDate(date: string): void {
  if (!DATE_RE.test(date)) throw new Error(`Invalid date: ${date}`)
}

function optionalNumber(n: number | null | undefined, min: number, max: number, label: string): number | null {
  if (n == null) return null
  if (typeof n !== 'number' || !isFinite(n) || n < min || n > max) throw new Error(`Invalid ${label}`)
  return n
}

export class Repo {
  constructor(private readonly store: Store) {}

  private get db() {
    return this.store.orm
  }

  // ---------- activities ----------

  listActivities(from: string, to: string): Activity[] {
    assertDate(from)
    assertDate(to)
    return this.db
      .select()
      .from(activities)
      .where(between(activities.date, from, to))
      .orderBy(desc(activities.date), desc(activities.startedAt))
      .all()
      .map(toActivity)
  }

  addActivity(input: NewActivity): Activity {
    assertDate(input.date)
    if (!ACTIVITY_KINDS.includes(input.kind)) throw new Error('Invalid activity type')
    const row = this.db
      .insert(activities)
      .values({
        kind: input.kind,
        source: 'manual',
        externalId: null,
        date: input.date,
        startedAt: null,
        title: input.title?.trim() || null,
        durationSec: optionalNumber(input.durationSec, 0, 86_400, 'duration'),
        distanceM: optionalNumber(input.distanceM, 0, 1_000_000, 'distance'),
        detail: '{}'
      })
      .returning()
      .get()
    this.store.changed()
    return toActivity(row)
  }

  /** Insert or update an activity that came from a sync. Returns true if it was new. */
  upsertSynced(row: ActivityRow): boolean {
    const existing = this.db
      .select({ id: activities.id })
      .from(activities)
      .where(and(eq(activities.source, row.source), eq(activities.externalId, row.externalId)))
      .get()
    const values = {
      kind: row.kind,
      source: row.source,
      externalId: row.externalId,
      date: row.date,
      startedAt: row.startedAt,
      title: row.title,
      durationSec: row.durationSec,
      distanceM: row.distanceM,
      detail: JSON.stringify(row.detail)
    }
    if (existing) {
      this.db.update(activities).set(values).where(eq(activities.id, existing.id)).run()
    } else {
      this.db.insert(activities).values(values).run()
    }
    this.store.changed()
    return !existing
  }

  hasActivity(source: ActivitySource, externalId: string): boolean {
    return !!this.db
      .select({ id: activities.id })
      .from(activities)
      .where(and(eq(activities.source, source), eq(activities.externalId, externalId)))
      .get()
  }

  latestActivityDate(source: ActivitySource): string | null {
    const row = this.db
      .select({ date: activities.date })
      .from(activities)
      .where(eq(activities.source, source))
      .orderBy(desc(activities.date))
      .limit(1)
      .get()
    return row?.date ?? null
  }

  deleteActivity(id: number): void {
    this.db.delete(activities).where(eq(activities.id, id)).run()
    this.store.changed()
  }

  // ---------- weights ----------

  listWeights(from: string, to: string): WeightEntry[] {
    assertDate(from)
    assertDate(to)
    return this.db
      .select()
      .from(weights)
      .where(between(weights.date, from, to))
      .orderBy(asc(weights.date), asc(weights.measuredAt))
      .all()
      .map(toWeight)
  }

  addWeight(input: NewWeight): WeightEntry {
    assertDate(input.date)
    const kg = optionalNumber(input.kg, 20, 400, 'weight')
    if (kg == null) throw new Error('Weight is required')
    const row = this.db
      .insert(weights)
      .values({
        date: input.date,
        measuredAt: new Date().toISOString(),
        kg,
        fatPct: optionalNumber(input.fatPct, 1, 75, 'body fat'),
        source: 'manual',
        externalId: null
      })
      .returning()
      .get()
    this.store.changed()
    return toWeight(row)
  }

  deleteWeight(id: number): void {
    this.db.delete(weights).where(eq(weights.id, id)).run()
    this.store.changed()
  }

  // ---------- meals ----------

  listMeals(date: string): Meal[] {
    assertDate(date)
    return this.db.select().from(meals).where(eq(meals.date, date)).orderBy(asc(meals.id)).all().map(toMeal)
  }

  addMeal(input: NewMeal): Meal {
    assertDate(input.date)
    const description = input.description.trim()
    if (!description) throw new Error('Describe the meal')
    if (!MEAL_SLOTS.includes(input.slot)) throw new Error('Invalid meal')
    if (!['small', 'normal', 'large'].includes(input.portion)) throw new Error('Invalid portion')
    const row = this.db
      .insert(meals)
      .values({
        date: input.date,
        slot: input.slot,
        description: description.slice(0, 500),
        portion: input.portion,
        kcal: optionalNumber(input.kcal, 0, 10_000, 'calories'),
        proteinG: optionalNumber(input.proteinG, 0, 1_000, 'protein'),
        source: 'manual'
      })
      .returning()
      .get()
    this.store.changed()
    return toMeal(row)
  }

  deleteMeal(id: number): void {
    this.db.delete(meals).where(eq(meals.id, id)).run()
    this.store.changed()
  }
}

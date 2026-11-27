import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const activities = sqliteTable(
  'activities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind').notNull(),
    source: text('source').notNull(),
    externalId: text('external_id'),
    date: text('date').notNull(),
    startedAt: text('started_at'),
    title: text('title'),
    durationSec: integer('duration_sec'),
    distanceM: real('distance_m'),
    detail: text('detail').notNull().default('{}')
  },
  (t) => [uniqueIndex('activities_source_external').on(t.source, t.externalId), index('activities_date').on(t.date)]
)

export const weights = sqliteTable(
  'weights',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    date: text('date').notNull(),
    measuredAt: text('measured_at').notNull(),
    kg: real('kg').notNull(),
    fatPct: real('fat_pct'),
    source: text('source').notNull(),
    externalId: text('external_id')
  },
  (t) => [uniqueIndex('weights_source_external').on(t.source, t.externalId), index('weights_date').on(t.date)]
)

export const meals = sqliteTable(
  'meals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    date: text('date').notNull(),
    slot: text('slot').notNull(),
    description: text('description').notNull(),
    portion: text('portion').notNull(),
    kcal: integer('kcal'),
    proteinG: integer('protein_g'),
    source: text('source').notNull()
  },
  (t) => [index('meals_date').on(t.date)]
)

/**
 * Each entry upgrades the database by one version. Never edit a released
 * entry; add a new one instead.
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    external_id TEXT,
    date TEXT NOT NULL,
    started_at TEXT,
    title TEXT,
    duration_sec INTEGER,
    distance_m REAL,
    detail TEXT NOT NULL DEFAULT '{}'
  );
  CREATE UNIQUE INDEX activities_source_external ON activities (source, external_id);
  CREATE INDEX activities_date ON activities (date);

  CREATE TABLE weights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    measured_at TEXT NOT NULL,
    kg REAL NOT NULL,
    fat_pct REAL,
    source TEXT NOT NULL,
    external_id TEXT
  );
  CREATE UNIQUE INDEX weights_source_external ON weights (source, external_id);
  CREATE INDEX weights_date ON weights (date);

  CREATE TABLE meals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    slot TEXT NOT NULL,
    description TEXT NOT NULL,
    portion TEXT NOT NULL,
    kcal INTEGER,
    protein_g INTEGER,
    source TEXT NOT NULL
  );
  CREATE INDEX meals_date ON meals (date);
  `
]

// Types shared by the main process, the preload bridge and the window.
import type { Habit } from './habits.ts'

export const ACTIVITY_KINDS = [
  'lift',
  'row',
  'climb',
  'hike',
  'run',
  'walk',
  'other',
  'stretch',
  'meditate',
  'art',
  'music',
  'piano'
] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

/** Physical training: the weekly plan, typical lengths and active minutes use these. */
export const TRAINING_KINDS = ['lift', 'row', 'climb', 'hike', 'run', 'walk', 'other'] as const satisfies readonly ActivityKind[]

/** Practices that count toward habits but not toward active minutes. */
export function isTraining(kind: ActivityKind): boolean {
  return (TRAINING_KINDS as readonly string[]).includes(kind)
}

export const KIND_LABELS: Record<ActivityKind, string> = {
  lift: 'Lift',
  row: 'Row',
  climb: 'Climb',
  hike: 'Hike',
  run: 'Run',
  walk: 'Walk',
  other: 'Other',
  stretch: 'Stretch',
  meditate: 'Meditate',
  art: 'Art',
  music: 'Music',
  piano: 'Piano'
}

/** habit: a check-in from a habit (ticked in Arete, Todoist or Praxis). */
export type ActivitySource = 'manual' | 'habit' | 'hevy' | 'concept2'

export interface Activity {
  id: number
  kind: ActivityKind
  source: ActivitySource
  externalId: string | null
  /** Local calendar date, YYYY-MM-DD. */
  date: string
  /** ISO timestamp when known. */
  startedAt: string | null
  title: string | null
  durationSec: number | null
  distanceM: number | null
  /** Source-specific numbers, e.g. rowing pace or lifting volume. */
  detail: ActivityDetail
}

/** Best set of one exercise in one Hevy workout. */
export interface LiftSummary {
  name: string
  templateId: string | null
  /** Working sets (warm-ups excluded). */
  sets: number
  /** Best estimated one-rep max in kg (Epley), or null for bodyweight-only work. */
  bestE1rmKg: number | null
  /** Heaviest working weight in kg, or null for bodyweight-only work. */
  topWeightKg: number | null
  /** Most reps in a single working set. */
  bestReps: number
}

export interface ActivityDetail {
  paceSecPer500?: number
  avgHeartRate?: number
  strokeRate?: number
  workoutType?: string
  calories?: number
  exercises?: number
  sets?: number
  volumeKg?: number
  /** Per-exercise bests, for strength charts. */
  lifts?: LiftSummary[]
}

export interface NewActivity {
  kind: ActivityKind
  date: string
  title?: string | null
  durationSec?: number | null
  distanceM?: number | null
}

export interface WeightEntry {
  id: number
  date: string
  measuredAt: string
  kg: number
  fatPct: number | null
  source: 'manual' | 'withings'
}

export interface NewWeight {
  date: string
  kg: number
  fatPct?: number | null
}

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type MealSlot = (typeof MEAL_SLOTS)[number]
export type Portion = 'small' | 'normal' | 'large'

export interface Meal {
  id: number
  date: string
  slot: MealSlot
  description: string
  portion: Portion
  kcal: number | null
  proteinG: number | null
  source: 'plan' | 'manual' | 'estimate'
  /** Range around an estimate, when the calories were estimated. */
  kcalLow: number | null
  kcalHigh: number | null
  /** What the estimate assumed, in a few words. */
  note: string | null
}

export interface NewMeal {
  date: string
  slot: MealSlot
  description: string
  portion: Portion
  kcal?: number | null
  proteinG?: number | null
}

/** Index 0 is Monday, 6 is Sunday. */
export type WeeklyPlan = ActivityKind[][]

export interface TrainingProgram {
  name: string
  /** YYYY-MM-DD of the program's first day. */
  start: string
  weeks: number
  kind: ActivityKind
}

export type Units = 'lb' | 'kg'

/** Age groups with VO2max reference percentiles (FRIEND registry, men). */
export type AgeGroup = '20-29' | '30-39'

/** Concept2's VO2max formula differs for highly trained rowers. */
export type RowingTrainingLevel = 'low' | 'high'

/** auto: colours follow the time of day; light or dark: fixed. */
export type ThemeMode = 'auto' | 'light' | 'dark'

/** Used only to work out sunrise and sunset for the lighting. */
export interface SunLocation {
  lat: number
  lon: number
}

/** Typical minutes for sessions logged without a duration, by activity type. */
export type TypicalMinutes = Partial<Record<ActivityKind, number>>

export const SECRET_NAMES = ['hevy', 'concept2', 'anthropic', 'todoist'] as const
export type SecretName = (typeof SECRET_NAMES)[number]

export type SyncSource = 'hevy' | 'concept2' | 'todoist'

export interface SyncStatus {
  at: string
  ok: boolean
  message: string
}

export interface PublicSettings {
  units: Units
  typicalMinutes: TypicalMinutes
  ageGroup: AgeGroup
  rowingLevel: RowingTrainingLevel
  /** Start Arete when Windows starts. */
  openAtLogin: boolean
  themeMode: ThemeMode
  /** Null means a rough guess from the time zone. */
  sunLocation: SunLocation | null
  habits: Habit[]
  /** While today is on or before this date, habits ask only for their minimum version. */
  recoveryUntil: string | null
  /** Take habits from @habit tasks in Todoist and keep them in step. Needs a Todoist token. */
  habitTasks: boolean
  plan: WeeklyPlan
  program: TrainingProgram | null
  /** Which keys are saved. The keys themselves never leave the main process. */
  secrets: Record<SecretName, boolean>
  canEncrypt: boolean
  lastSync: Partial<Record<SyncSource, SyncStatus>>
}

export interface SettingsPatch {
  units?: Units
  typicalMinutes?: TypicalMinutes
  ageGroup?: AgeGroup
  rowingLevel?: RowingTrainingLevel
  openAtLogin?: boolean
  themeMode?: ThemeMode
  sunLocation?: SunLocation | null
  habits?: Habit[]
  recoveryUntil?: string | null
  habitTasks?: boolean
  plan?: WeeklyPlan
  program?: TrainingProgram | null
}

export interface DayView {
  date: string
  planned: ActivityKind[]
  /** Planned kinds that have at least one matching activity that day. */
  plannedDone: ActivityKind[]
  activities: Activity[]
}

export interface WeekView {
  weekStart: string
  days: DayView[]
  plannedCount: number
  plannedDoneCount: number
  program: { name: string; week: number; total: number; kind: ActivityKind } | null
}

export interface SyncReport {
  results: Partial<Record<SyncSource, SyncStatus>>
}

export interface ImportResult {
  fileName: string
  /** Weigh-ins found in the file. */
  total: number
  added: number
  updated: number
  /** Date range of the weigh-ins in the file. */
  from: string | null
  to: string | null
}

export interface AppInfo {
  version: string
  /** False when running from source, where updates and start-up launch don't apply. */
  packaged: boolean
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'latest'; checkedAt: string }
  | { state: 'error'; message: string }
  | { state: 'unavailable' }

/** The API the window can call, exposed by the preload script as window.arete. */
export interface AreteApi {
  appInfo(): Promise<AppInfo>
  getSettings(): Promise<PublicSettings>
  updateSettings(patch: SettingsPatch): Promise<PublicSettings>
  setSecret(name: SecretName, value: string | null): Promise<PublicSettings>

  getWeek(weekStart: string): Promise<WeekView>
  listActivities(from: string, to: string): Promise<Activity[]>
  addActivity(input: NewActivity): Promise<Activity>
  deleteActivity(id: number): Promise<void>

  listWeights(from: string, to: string): Promise<WeightEntry[]>
  addWeight(input: NewWeight): Promise<WeightEntry>
  deleteWeight(id: number): Promise<void>
  /** Opens a file picker for a Withings export. Resolves to null if cancelled. */
  importWithings(): Promise<ImportResult | null>

  listMeals(date: string): Promise<Meal[]>
  listMealsRange(from: string, to: string): Promise<Meal[]>
  /** Estimates calories and protein from the meal's description. Needs an Anthropic key. */
  estimateMeal(id: number): Promise<Meal>
  addMeal(input: NewMeal): Promise<Meal>
  deleteMeal(id: number): Promise<void>

  getUpdateStatus(): Promise<UpdateStatus>
  checkForUpdates(): Promise<UpdateStatus>
  /** Quits, installs the downloaded update and reopens Arete. */
  installUpdate(): Promise<void>
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void

  /** Logs a habit as done today (full or minimum version) and ticks its Todoist task. */
  logHabit(habitId: string, version: 'full' | 'minimum'): Promise<Activity>
  /** Starts a habit from the "Up next" queue, giving its Todoist task these days and time. */
  startHabit(
    habitId: string,
    plan: { days: number[]; time: string | null; startDate: string; fullMinutes: number }
  ): Promise<PublicSettings>

  syncNow(): Promise<SyncReport>
  onSynced(callback: (report: SyncReport) => void): () => void
}

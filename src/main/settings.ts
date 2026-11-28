// App settings, kept in settings.json in Arete's own data folder (never in the repo).
// API keys are encrypted with Electron's safeStorage (Windows DPAPI) and are
// never sent to the window: it only learns whether each key is saved.
import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import { emptyPlan } from '../shared/logic.ts'
import { validHabit, type Habit } from '../shared/habits.ts'
import {
  ACTIVITY_KINDS,
  type AgeGroup,
  type RowingTrainingLevel,
  type SunLocation,
  type ThemeMode,
  type TypicalMinutes,
  SECRET_NAMES,
  type PublicSettings,
  type SecretName,
  type SettingsPatch,
  type SyncSource,
  type SyncStatus,
  type TrainingProgram,
  type WeeklyPlan
} from '../shared/types.ts'

interface StoredSettings {
  units: 'lb' | 'kg'
  typicalMinutes: TypicalMinutes
  ageGroup: AgeGroup
  rowingLevel: RowingTrainingLevel
  openAtLogin: boolean
  themeMode: ThemeMode
  sunLocation: SunLocation | null
  habits: Habit[]
  recoveryUntil: string | null
  habitTasks: boolean
  /** Ids of wins already announced with a notification. */
  notifiedWins: string[]
  /** Monday of the last week whose review was put in Todoist. */
  lastReviewWeek: string | null
  plan: WeeklyPlan
  program: TrainingProgram | null
  secrets: Partial<Record<SecretName, string>>
  lastSync: Partial<Record<SyncSource, SyncStatus>>
}

const DEFAULTS: StoredSettings = {
  units: 'lb',
  typicalMinutes: {},
  ageGroup: '20-29',
  rowingLevel: 'low',
  openAtLogin: true,
  themeMode: 'auto',
  sunLocation: null,
  habits: [],
  recoveryUntil: null,
  habitTasks: true,
  notifiedWins: [],
  lastReviewWeek: null,
  plan: emptyPlan(),
  program: null,
  secrets: {},
  lastSync: {}
}

function validPlan(plan: unknown): plan is WeeklyPlan {
  return (
    Array.isArray(plan) &&
    plan.length === 7 &&
    plan.every((day) => Array.isArray(day) && day.every((k) => ACTIVITY_KINDS.includes(k)))
  )
}

function validTypicalMinutes(t: unknown): t is TypicalMinutes {
  return (
    typeof t === 'object' &&
    t !== null &&
    Object.entries(t).every(
      ([k, v]) => ACTIVITY_KINDS.includes(k as never) && Number.isInteger(v) && (v as number) > 0 && (v as number) <= 1440
    )
  )
}

function validHabits(h: unknown): h is Habit[] {
  return (
    Array.isArray(h) &&
    h.length <= 30 &&
    h.every((x) => validHabit(x) && ACTIVITY_KINDS.includes((x as Habit).kind)) &&
    new Set(h.map((x) => (x as Habit).id)).size === h.length
  )
}

function validDateOrNull(d: unknown): d is string | null {
  return d === null || d === undefined || (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
}

function validLocation(l: unknown): l is SunLocation | null {
  if (l === null) return true
  const loc = l as SunLocation
  return (
    typeof loc === 'object' &&
    typeof loc.lat === 'number' &&
    typeof loc.lon === 'number' &&
    Math.abs(loc.lat) <= 90 &&
    Math.abs(loc.lon) <= 180
  )
}

function validProgram(p: unknown): p is TrainingProgram | null {
  if (p === null) return true
  const prog = p as TrainingProgram
  return (
    typeof prog === 'object' &&
    typeof prog.name === 'string' &&
    prog.name.length <= 80 &&
    /^\d{4}-\d{2}-\d{2}$/.test(prog.start) &&
    Number.isInteger(prog.weeks) &&
    prog.weeks >= 1 &&
    prog.weeks <= 104 &&
    ACTIVITY_KINDS.includes(prog.kind)
  )
}

export class Settings {
  private data: StoredSettings

  constructor(private readonly file: string) {
    this.data = this.load()
  }

  private load(): StoredSettings {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<StoredSettings>
      return {
        units: parsed.units === 'kg' ? 'kg' : 'lb',
        typicalMinutes: validTypicalMinutes(parsed.typicalMinutes) ? parsed.typicalMinutes : {},
        ageGroup: parsed.ageGroup === '30-39' ? '30-39' : '20-29',
        rowingLevel: parsed.rowingLevel === 'high' ? 'high' : 'low',
        openAtLogin: parsed.openAtLogin !== false,
        themeMode: parsed.themeMode === 'light' || parsed.themeMode === 'dark' ? parsed.themeMode : 'auto',
        sunLocation: validLocation(parsed.sunLocation) ? (parsed.sunLocation ?? null) : null,
        habits: validHabits(parsed.habits) ? parsed.habits : [],
        recoveryUntil: validDateOrNull(parsed.recoveryUntil) ? (parsed.recoveryUntil ?? null) : null,
        habitTasks: parsed.habitTasks !== false,
        notifiedWins: Array.isArray(parsed.notifiedWins) ? parsed.notifiedWins.filter((x) => typeof x === 'string').slice(-300) : [],
        lastReviewWeek: validDateOrNull(parsed.lastReviewWeek) ? (parsed.lastReviewWeek ?? null) : null,
        plan: validPlan(parsed.plan) ? parsed.plan : emptyPlan(),
        program: validProgram(parsed.program) ? (parsed.program ?? null) : null,
        secrets: parsed.secrets ?? {},
        lastSync: parsed.lastSync ?? {}
      }
    } catch {
      return structuredClone(DEFAULTS)
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    fs.renameSync(tmp, this.file)
  }

  get units() {
    return this.data.units
  }
  get openAtLogin() {
    return this.data.openAtLogin
  }
  get plan() {
    return this.data.plan
  }
  get program() {
    return this.data.program
  }

  public(): PublicSettings {
    const secrets = Object.fromEntries(SECRET_NAMES.map((n) => [n, !!this.data.secrets[n]])) as Record<
      SecretName,
      boolean
    >
    return {
      units: this.data.units,
      typicalMinutes: this.data.typicalMinutes,
      ageGroup: this.data.ageGroup,
      rowingLevel: this.data.rowingLevel,
      openAtLogin: this.data.openAtLogin,
      themeMode: this.data.themeMode,
      sunLocation: this.data.sunLocation,
      habits: this.data.habits,
      recoveryUntil: this.data.recoveryUntil,
      habitTasks: this.data.habitTasks,
      plan: this.data.plan,
      program: this.data.program,
      secrets,
      canEncrypt: safeStorage.isEncryptionAvailable(),
      lastSync: this.data.lastSync
    }
  }

  update(patch: SettingsPatch): void {
    if (patch.units !== undefined) {
      if (patch.units !== 'lb' && patch.units !== 'kg') throw new Error('Invalid units')
      this.data.units = patch.units
    }
    if (patch.typicalMinutes !== undefined) {
      if (!validTypicalMinutes(patch.typicalMinutes)) throw new Error('Invalid session lengths')
      this.data.typicalMinutes = patch.typicalMinutes
    }
    if (patch.ageGroup !== undefined) {
      if (patch.ageGroup !== '20-29' && patch.ageGroup !== '30-39') throw new Error('Invalid age group')
      this.data.ageGroup = patch.ageGroup
    }
    if (patch.rowingLevel !== undefined) {
      if (patch.rowingLevel !== 'low' && patch.rowingLevel !== 'high') throw new Error('Invalid training level')
      this.data.rowingLevel = patch.rowingLevel
    }
    if (patch.openAtLogin !== undefined) {
      if (typeof patch.openAtLogin !== 'boolean') throw new Error('Invalid start-up setting')
      this.data.openAtLogin = patch.openAtLogin
    }
    if (patch.themeMode !== undefined) {
      if (!['auto', 'light', 'dark'].includes(patch.themeMode)) throw new Error('Invalid theme')
      this.data.themeMode = patch.themeMode
    }
    if (patch.sunLocation !== undefined) {
      if (!validLocation(patch.sunLocation)) throw new Error('Invalid location')
      this.data.sunLocation = patch.sunLocation
    }
    if (patch.habits !== undefined) {
      if (!validHabits(patch.habits)) throw new Error('Invalid habits')
      this.data.habits = patch.habits
    }
    if (patch.recoveryUntil !== undefined) {
      if (!validDateOrNull(patch.recoveryUntil)) throw new Error('Invalid recovery date')
      this.data.recoveryUntil = patch.recoveryUntil
    }
    if (patch.habitTasks !== undefined) {
      if (typeof patch.habitTasks !== 'boolean') throw new Error('Invalid Todoist setting')
      this.data.habitTasks = patch.habitTasks
    }
    if (patch.plan !== undefined) {
      if (!validPlan(patch.plan)) throw new Error('Invalid weekly plan')
      this.data.plan = patch.plan
    }
    if (patch.program !== undefined) {
      if (!validProgram(patch.program)) throw new Error('Invalid program')
      this.data.program = patch.program
    }
    this.save()
  }

  setSecret(name: SecretName, value: string | null): void {
    if (!SECRET_NAMES.includes(name)) throw new Error('Unknown key')
    if (value === null || value.trim() === '') {
      delete this.data.secrets[name]
    } else {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Windows encryption is unavailable, so the key was not saved.')
      }
      this.data.secrets[name] = safeStorage.encryptString(value.trim()).toString('base64')
    }
    this.save()
  }

  /** Decrypted key for use in the main process only. */
  getSecret(name: SecretName): string | null {
    const stored = this.data.secrets[name]
    if (!stored) return null
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'))
    } catch {
      return null
    }
  }

  get habits() {
    return this.data.habits
  }
  get recoveryUntil() {
    return this.data.recoveryUntil
  }
  get habitTasks() {
    return this.data.habitTasks
  }
  wasNotified(id: string): boolean {
    return this.data.notifiedWins.includes(id)
  }
  markNotified(ids: string[]): void {
    if (ids.length === 0) return
    this.data.notifiedWins = [...this.data.notifiedWins, ...ids].slice(-300)
    this.save()
  }
  get lastReviewWeek() {
    return this.data.lastReviewWeek
  }
  setLastReviewWeek(week: string): void {
    this.data.lastReviewWeek = week
    this.save()
  }

  recordSync(source: SyncSource, status: SyncStatus): void {
    this.data.lastSync[source] = status
    this.save()
  }
}

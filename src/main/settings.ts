// App settings, kept in settings.json in Arete's own data folder (never in the repo).
// API keys are encrypted with Electron's safeStorage (Windows DPAPI) and are
// never sent to the window: it only learns whether each key is saved.
import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import { emptyPlan } from '../shared/logic.ts'
import {
  ACTIVITY_KINDS,
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
  plan: WeeklyPlan
  program: TrainingProgram | null
  secrets: Partial<Record<SecretName, string>>
  lastSync: Partial<Record<SyncSource, SyncStatus>>
}

const DEFAULTS: StoredSettings = {
  units: 'lb',
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

  recordSync(source: SyncSource, status: SyncStatus): void {
    this.data.lastSync[source] = status
    this.save()
  }
}

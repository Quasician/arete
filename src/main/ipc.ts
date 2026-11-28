import fs from 'node:fs'
import path from 'node:path'
import { app, clipboard, dialog, ipcMain, type BrowserWindow } from 'electron'
import { log } from './log.ts'
import { diagnostics } from './diagnostics.ts'
import type { Repo } from './repo.ts'
import type { Settings } from './settings.ts'
import { syncAll } from './sync/index.ts'
import { readWithingsExport } from './importers/withings.ts'
import { checkForUpdates, getUpdateStatus, installUpdate } from './updater.ts'
import { applyOpenAtLogin } from './startup.ts'
import { estimateMeal } from './estimate.ts'
import { inRecovery, startQueuedHabit, syncHabitTasks } from './habitSync.ts'
import { announceWins } from './announce.ts'
import { applyProgression, previewProgression, routineExerciseNames } from './progress.ts'
import { toLocalDate } from '../shared/logic.ts'
import { addDays, buildWeek } from '../shared/logic.ts'
import type {
  ImportResult,
  NewActivity,
  NewMeal,
  NewWeight,
  SecretName,
  SettingsPatch,
  SyncReport
} from '../shared/types.ts'

export const SYNCED_EVENT = 'arete:synced'

export function registerIpc(repo: Repo, settings: Settings, getWindow: () => BrowserWindow | null): void {
  // Every failure the window sees also goes in the log, with which action it was.
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R) =>
    ipcMain.handle(`arete:${channel}`, async (_event, ...args) => {
      try {
        return await fn(...(args as A))
      } catch (err) {
        log('action', channel, 'FAILED', err)
        throw err
      }
    })

  handle('appInfo', () => ({ version: app.getVersion(), packaged: app.isPackaged }))
  handle('getUpdateStatus', () => getUpdateStatus())
  handle('checkForUpdates', () => checkForUpdates())
  handle('installUpdate', () => installUpdate())
  handle('getSettings', () => settings.public())
  handle('updateSettings', (patch: SettingsPatch) => {
    settings.update(patch)
    if (patch.openAtLogin !== undefined) applyOpenAtLogin(settings.openAtLogin)
    if (patch.habits !== undefined || patch.habitTasks !== undefined || patch.recoveryUntil !== undefined) {
      void runHabitSync(repo, settings, getWindow)
    }
    return settings.public()
  })
  handle('setSecret', (name: SecretName, value: string | null) => {
    settings.setSecret(name, value)
    if (name === 'todoist' && value) void runHabitSync(repo, settings, getWindow)
    return settings.public()
  })

  handle('getWeek', (weekStart: string) =>
    buildWeek(weekStart, settings.plan, repo.listActivities(weekStart, addDays(weekStart, 6)), settings.program)
  )
  handle('listActivities', (from: string, to: string) => repo.listActivities(from, to))
  handle('addActivity', (input: NewActivity) => repo.addActivity(input))
  handle('deleteActivity', (id: number) => repo.deleteActivity(id))

  handle('listWeights', (from: string, to: string) => repo.listWeights(from, to))
  handle('addWeight', (input: NewWeight) => repo.addWeight(input))
  handle('deleteWeight', (id: number) => repo.deleteWeight(id))
  handle('importWithings', async (): Promise<ImportResult | null> => {
    const win = getWindow()
    const options = {
      title: 'Import a Withings export',
      buttonLabel: 'Import',
      properties: ['openFile' as const],
      filters: [
        { name: 'Withings export (ZIP or CSV)', extensions: ['zip', 'csv'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) return null
    const file = picked.filePaths[0]
    const stat = fs.statSync(file)
    if (stat.size > 200 * 1024 * 1024) throw new Error('That file is too large to be a Withings export.')
    const fileName = path.basename(file)
    const rows = readWithingsExport(fileName, new Uint8Array(fs.readFileSync(file)))
    const { added, updated } = repo.importWithingsWeights(rows)
    log('withings import', `${rows.length} readings`, `${added} added`, `${updated} updated`)
    const dates = rows.map((r) => r.date).sort()
    return { fileName, total: rows.length, added, updated, from: dates[0] ?? null, to: dates.at(-1) ?? null }
  })

  handle('listMeals', (date: string) => repo.listMeals(date))
  handle('listMealsRange', (from: string, to: string) => repo.listMealsRange(from, to))
  handle('estimateMeal', async (id: number) => {
    const key = settings.getSecret('anthropic')
    if (!key) throw new Error('Add an Anthropic API key in Settings to estimate calories.')
    const meal = repo.getMeal(id)
    if (!meal) throw new Error('That meal no longer exists.')
    const estimate = await estimateMeal(key, meal)
    return repo.saveMealEstimate(id, estimate)
  })
  handle('addMeal', (input: NewMeal) => repo.addMeal(input))
  handle('deleteMeal', (id: number) => repo.deleteMeal(id))

  handle('logHabit', async (habitId: string, version: 'full' | 'minimum') => {
    const h = settings.habits.find((x) => x.id === habitId)
    if (!h) throw new Error('That habit no longer exists.')
    if (version !== 'full' && version !== 'minimum') throw new Error('Invalid version')
    const today = toLocalDate(new Date())
    const minutes = version === 'minimum' || inRecovery(settings, today) ? h.minimumMinutes : h.fullMinutes
    const activity = repo.addHabitCheckIn(h.kind, today, h.name, minutes)
    void runHabitSync(repo, settings, getWindow).then(() => announceWins(settings, repo))
    return activity
  })

  handle('startHabit', async (habitId: string, plan: { days: number[]; time: string | null; startDate: string; fullMinutes: number }) => {
    if (
      !plan ||
      !Array.isArray(plan.days) ||
      plan.days.length === 0 ||
      !plan.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) ||
      (plan.time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.time)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(plan.startDate) ||
      !Number.isInteger(plan.fullMinutes) ||
      plan.fullMinutes < 1 ||
      plan.fullMinutes > 600
    ) {
      throw new Error('Pick at least one day, and a length between 1 and 600 minutes.')
    }
    await startQueuedHabit(settings, habitId, plan)
    void runHabitSync(repo, settings, getWindow)
    return settings.public()
  })

  handle('routineExercises', () => routineExerciseNames(settings))
  handle('previewProgression', () => previewProgression(settings, repo))
  handle('applyProgression', () => applyProgression(settings, repo, app.getPath('userData')))

  handle('syncNow', () => runSync(repo, settings, getWindow))

  handle('copyDiagnostics', () => {
    clipboard.writeText(diagnostics(settings, repo))
    log('diagnostics copied')
    return true
  })
  handle('logWindowError', (message: string) => {
    if (typeof message === 'string') log('window error', message.slice(0, 1000))
  })
}

export async function runSync(
  repo: Repo,
  settings: Settings,
  getWindow: () => BrowserWindow | null
): Promise<SyncReport> {
  const report = await syncAll(settings, repo)
  for (const [source, st] of Object.entries(report.results)) log('sync', source, st.ok ? 'ok' : 'FAILED', st.message)
  // After new workouts arrive, move the Hevy routines on to their next targets.
  if (settings.progression.enabled && report.results.hevy?.ok) {
    try {
      const changes = await applyProgression(settings, repo, app.getPath('userData'))
      log('progression after sync', `${changes.length} change(s)`)
      if (changes.length) {
        report.results.hevy = {
          ...report.results.hevy,
          message: `${report.results.hevy.message}; ${changes.length} routine target${changes.length === 1 ? '' : 's'} moved on`
        }
        settings.recordSync('hevy', report.results.hevy)
      }
    } catch (err) {
      log('progression after sync FAILED', err)
      report.results.hevy = { at: new Date().toISOString(), ok: false, message: err instanceof Error ? err.message : String(err) }
      settings.recordSync('hevy', report.results.hevy)
    }
  }
  const habitError = await runHabitSync(repo, settings, getWindow, false)
  if (settings.getSecret('todoist') && settings.habitTasks) {
    report.results.todoist = {
      at: new Date().toISOString(),
      ok: !habitError,
      message: habitError ?? 'Habits are in step with Todoist'
    }
  }
  try {
    announceWins(settings, repo)
  } catch {
    // Announcing is a bonus; never let it break syncing.
  }
  getWindow()?.webContents.send(SYNCED_EVENT, report)
  return report
}

/** Syncs habit tasks with Todoist, records the outcome and refreshes the window. */
export async function runHabitSync(
  repo: Repo,
  settings: Settings,
  getWindow: () => BrowserWindow | null,
  notifyWindow = true
): Promise<string | null> {
  if (!settings.getSecret('todoist') || !settings.habitTasks) return null
  const error = await syncHabitTasks(settings, repo)
  log('todoist habits', error ? `FAILED ${error}` : 'ok')
  settings.recordSync('todoist', {
    at: new Date().toISOString(),
    ok: !error,
    message: error ?? 'Habits are in step with Todoist'
  })
  if (notifyWindow) getWindow()?.webContents.send(SYNCED_EVENT, { results: {} })
  return error
}

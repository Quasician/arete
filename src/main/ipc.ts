import fs from 'node:fs'
import path from 'node:path'
import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import type { Repo } from './repo.ts'
import type { Settings } from './settings.ts'
import { syncAll } from './sync/index.ts'
import { readWithingsExport } from './importers/withings.ts'
import { checkForUpdates, getUpdateStatus, installUpdate } from './updater.ts'
import { applyOpenAtLogin } from './startup.ts'
import { estimateMeal } from './estimate.ts'
import { inRecovery, syncHabitTasks } from './habitSync.ts'
import { announceWins } from './announce.ts'
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
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R) =>
    ipcMain.handle(`arete:${channel}`, (_event, ...args) => fn(...(args as A)))

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
    const activity = repo.addActivity({ kind: h.kind, date: today, title: h.name, durationSec: minutes * 60 })
    void runHabitSync(repo, settings, getWindow).then(() => announceWins(settings, repo))
    return activity
  })

  handle('syncNow', () => runSync(repo, settings, getWindow))
}

export async function runSync(
  repo: Repo,
  settings: Settings,
  getWindow: () => BrowserWindow | null
): Promise<SyncReport> {
  const report = await syncAll(settings, repo)
  const habitError = await runHabitSync(repo, settings, getWindow, false)
  if (settings.getSecret('todoist') && settings.habitTasks && settings.habits.some((h) => h.active)) {
    report.results.todoist = {
      at: new Date().toISOString(),
      ok: !habitError,
      message: habitError ?? 'Habits are up to date in Todoist'
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
  settings.recordSync('todoist', {
    at: new Date().toISOString(),
    ok: !error,
    message: error ?? 'Habits are up to date in Todoist'
  })
  if (notifyWindow) getWindow()?.webContents.send(SYNCED_EVENT, { results: {} })
  return error
}

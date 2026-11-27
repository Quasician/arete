import { app, ipcMain, type BrowserWindow } from 'electron'
import type { Repo } from './repo.ts'
import type { Settings } from './settings.ts'
import { syncAll } from './sync/index.ts'
import { addDays, buildWeek } from '../shared/logic.ts'
import type { NewActivity, NewMeal, NewWeight, SecretName, SettingsPatch, SyncReport } from '../shared/types.ts'

export const SYNCED_EVENT = 'arete:synced'

export function registerIpc(repo: Repo, settings: Settings, getWindow: () => BrowserWindow | null): void {
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R) =>
    ipcMain.handle(`arete:${channel}`, (_event, ...args) => fn(...(args as A)))

  handle('appInfo', () => ({ version: app.getVersion() }))
  handle('getSettings', () => settings.public())
  handle('updateSettings', (patch: SettingsPatch) => {
    settings.update(patch)
    return settings.public()
  })
  handle('setSecret', (name: SecretName, value: string | null) => {
    settings.setSecret(name, value)
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

  handle('listMeals', (date: string) => repo.listMeals(date))
  handle('addMeal', (input: NewMeal) => repo.addMeal(input))
  handle('deleteMeal', (id: number) => repo.deleteMeal(id))

  handle('syncNow', () => runSync(repo, settings, getWindow))
}

export async function runSync(
  repo: Repo,
  settings: Settings,
  getWindow: () => BrowserWindow | null
): Promise<SyncReport> {
  const report = await syncAll(settings, repo)
  getWindow()?.webContents.send(SYNCED_EVENT, report)
  return report
}

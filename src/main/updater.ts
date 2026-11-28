// Checks GitHub releases for new versions, downloads them in the background
// and reports progress to the window, which offers a restart to install.
import { app, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '../shared/types.ts'

const { autoUpdater } = electronUpdater

export const UPDATE_EVENT = 'arete:update'
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

let status: UpdateStatus = { state: app.isPackaged ? 'idle' : 'unavailable' }
let getWindow: () => BrowserWindow | null = () => null

function set(next: UpdateStatus): UpdateStatus {
  status = next
  getWindow()?.webContents.send(UPDATE_EVENT, status)
  return status
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) return set({ state: 'unavailable' })
  // A downloaded update stays ready; don't throw it away by checking again.
  if (status.state === 'ready' || status.state === 'downloading' || status.state === 'checking') return status
  set({ state: 'checking' })
  try {
    const result = await autoUpdater.checkForUpdates()
    // When an update is found, the download events below take over the status.
    if (!result?.isUpdateAvailable) set({ state: 'latest', checkedAt: new Date().toISOString() })
  } catch (err) {
    set({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  }
  return status
}

export function installUpdate(): void {
  if (status.state !== 'ready') return
  // Quit, install silently and start Arete again.
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}

export function startUpdater(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  // If Arete is closed before the user restarts, install on quit anyway.
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('download-progress', (p) => {
    if (status.state === 'downloading') set({ ...status, percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => set({ state: 'error', message: err.message }))

  void checkForUpdates()
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS)
}

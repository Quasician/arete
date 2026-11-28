// Checks GitHub releases for new versions, downloads them in the background
// and reports progress to the window, which offers a restart to install.
import { log } from './log.ts'
import { app, Notification, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '../shared/types.ts'

const { autoUpdater } = electronUpdater

export const UPDATE_EVENT = 'arete:update'
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

let status: UpdateStatus = { state: app.isPackaged ? 'idle' : 'unavailable' }
let getWindow: () => BrowserWindow | null = () => null
/** Set when the user asked for a check, so the outcome is announced with a notification. */
let announce = false

function notify(body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title: 'Arete', body, silent: true })
  if (onClick) n.on('click', onClick)
  n.show()
}

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

/**
 * A check the user asked for, from the taskbar menu: always reports the result
 * with a notification, including when Arete is already up to date.
 */
export async function checkForUpdatesAndAnnounce(): Promise<void> {
  if (!app.isPackaged) return
  if (status.state === 'ready') {
    notify(`Version ${status.version} is ready. Click here to restart and install it.`, installUpdate)
    return
  }
  if (status.state === 'downloading') {
    announce = true
    notify(`Downloading version ${status.version}. You'll be told when it's ready.`)
    return
  }
  announce = true
  let result = await checkForUpdates()
  // A check already running (e.g. the one at start-up) returns at once; wait for its outcome.
  for (let waited = 0; result.state === 'checking' && waited < 60_000; waited += 500) {
    await new Promise((r) => setTimeout(r, 500))
    result = status
  }
  if (result.state === 'latest') {
    announce = false
    notify(`Arete is up to date (version ${app.getVersion()}).`)
  } else if (result.state === 'error') {
    announce = false
    notify(`Couldn't check for updates: ${result.message}`)
  } else if (result.state === 'downloading') {
    notify(`Downloading version ${result.version}. You'll be told when it's ready.`)
  }
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
  autoUpdater.on('update-downloaded', (info) => {
    log('update downloaded', info.version)
    set({ state: 'ready', version: info.version })
    if (announce) {
      announce = false
      notify(`Version ${info.version} is ready. Click here to restart and install it.`, installUpdate)
    }
  })
  autoUpdater.on('error', (err) => {
    log('update error', err.message)
    set({ state: 'error', message: err.message })
  })

  void checkForUpdates()
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS)
}

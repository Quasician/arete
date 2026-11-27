import path from 'node:path'
import { app, BrowserWindow, Menu, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { Store } from './db.ts'
import { Repo } from './repo.ts'
import { Settings } from './settings.ts'
import { registerIpc, runSync } from './ipc.ts'

const { autoUpdater } = electronUpdater

const SYNC_EVERY_MS = 60 * 60 * 1000
const UPDATE_CHECK_EVERY_MS = 6 * 60 * 60 * 1000

let mainWindow: BrowserWindow | null = null
let store: Store | null = null

// One Arete at a time: launching it again focuses the open window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.whenReady().then(start)
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Arete',
    backgroundColor: '#0b1020',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => win.show())

  // Links open in the default browser; the window never navigates away from Arete.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  win.on('closed', () => {
    mainWindow = null
  })
  return win
}

async function start(): Promise<void> {
  app.setAppUserModelId('com.quasician.arete')
  Menu.setApplicationMenu(null)

  const dataDir = app.getPath('userData')
  const wasmFile = path.join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  store = await Store.open(path.join(dataDir, 'arete.sqlite'), wasmFile)
  const repo = new Repo(store)
  const settings = new Settings(path.join(dataDir, 'settings.json'))

  registerIpc(repo, settings, () => mainWindow)
  mainWindow = createWindow()

  // Sync shortly after opening, then hourly while Arete is running.
  const sync = () => void runSync(repo, settings, () => mainWindow).catch(() => undefined)
  setTimeout(sync, 5_000)
  setInterval(sync, SYNC_EVERY_MS)

  if (app.isPackaged) {
    const check = () => void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined)
    check()
    setInterval(check, UPDATE_CHECK_EVERY_MS)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  try {
    store?.close()
  } catch {
    // Nothing more to do while quitting.
  }
  store = null
})

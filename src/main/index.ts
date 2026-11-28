import path from 'node:path'
import { app, BrowserWindow, Menu, shell } from 'electron'
import { Store } from './db.ts'
import { Repo } from './repo.ts'
import { Settings } from './settings.ts'
import { registerIpc, runSync } from './ipc.ts'
import { loadWindowState, trackWindowState } from './windowState.ts'
import { startUpdater } from './updater.ts'
import { applyOpenAtLogin } from './startup.ts'

const SYNC_EVERY_MS = 60 * 60 * 1000

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
  const stateFile = path.join(app.getPath('userData'), 'window-state.json')
  const state = loadWindowState(stateFile)
  const win = new BrowserWindow({
    width: state.bounds?.width ?? 1600,
    height: state.bounds?.height ?? 1000,
    x: state.bounds?.x,
    y: state.bounds?.y,
    minWidth: 900,
    minHeight: 600,
    title: 'Arete',
    backgroundColor: '#0b1020',
    show: false,
    autoHideMenuBar: true,
    // In the installed app Windows takes the icon from Arete.exe.
    ...(app.isPackaged ? {} : { icon: path.join(__dirname, '../../build/icon.png') }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => {
    if (state.fullScreen) win.setFullScreen(true)
    else if (state.maximized) win.maximize()
    win.show()
  })
  trackWindowState(win, stateFile)

  // F11 toggles full screen, like Praxis on the wide monitor.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen())
      event.preventDefault()
    }
  })

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

  startUpdater(() => mainWindow)
  applyOpenAtLogin(settings.openAtLogin)

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

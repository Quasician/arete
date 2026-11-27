// Remembers the window's size, position and maximized/full-screen state between launches.
import fs from 'node:fs'
import { screen, type BrowserWindow, type Rectangle } from 'electron'

interface WindowState {
  bounds?: Rectangle
  maximized: boolean
  fullScreen: boolean
}

export function loadWindowState(file: string): WindowState {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8')) as WindowState
    // Ignore saved bounds that are no longer on any connected display.
    if (s.bounds && !screen.getAllDisplays().some((d) => overlaps(d.workArea, s.bounds!))) delete s.bounds
    return { bounds: s.bounds, maximized: !!s.maximized, fullScreen: !!s.fullScreen }
  } catch {
    // First launch: open maximized, which suits a wide monitor.
    return { maximized: true, fullScreen: false }
  }
}

function overlaps(a: Rectangle, b: Rectangle): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

export function trackWindowState(win: BrowserWindow, file: string): void {
  let timer: NodeJS.Timeout | null = null
  const save = () => {
    if (win.isDestroyed()) return
    const state: WindowState = {
      bounds: win.getNormalBounds(),
      maximized: win.isMaximized(),
      fullScreen: win.isFullScreen()
    }
    try {
      fs.writeFileSync(file, JSON.stringify(state))
    } catch {
      // Not worth interrupting the user over.
    }
  }
  const later = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 500)
  }
  for (const event of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) {
    win.on(event as 'resize', later)
  }
  win.on('close', save)
}

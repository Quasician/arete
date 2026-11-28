// Starts Arete when Windows starts, if the setting is on (it is by default).
import { app } from 'electron'

export function applyOpenAtLogin(enabled: boolean): void {
  // Running from source would register the development Electron binary instead.
  if (!app.isPackaged || process.platform !== 'win32') return
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath })
  } catch {
    // Not worth interrupting the user over; the setting can be toggled again.
  }
}

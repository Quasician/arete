import { contextBridge, ipcRenderer } from 'electron'
import type { AreteApi, SyncReport } from '../shared/types.ts'

const call =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(`arete:${channel}`, ...args)

const api: AreteApi = {
  appInfo: call('appInfo'),
  getSettings: call('getSettings'),
  updateSettings: call('updateSettings'),
  setSecret: call('setSecret'),
  getWeek: call('getWeek'),
  listActivities: call('listActivities'),
  addActivity: call('addActivity'),
  deleteActivity: call('deleteActivity'),
  listWeights: call('listWeights'),
  addWeight: call('addWeight'),
  deleteWeight: call('deleteWeight'),
  importWithings: call('importWithings'),
  listMeals: call('listMeals'),
  addMeal: call('addMeal'),
  deleteMeal: call('deleteMeal'),
  syncNow: call('syncNow'),
  onSynced(callback) {
    const listener = (_event: Electron.IpcRendererEvent, report: SyncReport) => callback(report)
    ipcRenderer.on('arete:synced', listener)
    return () => ipcRenderer.removeListener('arete:synced', listener)
  }
}

contextBridge.exposeInMainWorld('arete', api)

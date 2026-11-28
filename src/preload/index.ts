import { contextBridge, ipcRenderer } from 'electron'
import type { AreteApi, SyncReport, UpdateStatus } from '../shared/types.ts'

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
  listMealsRange: call('listMealsRange'),
  estimateMeal: call('estimateMeal'),
  addMeal: call('addMeal'),
  deleteMeal: call('deleteMeal'),
  getUpdateStatus: call('getUpdateStatus'),
  checkForUpdates: call('checkForUpdates'),
  installUpdate: call('installUpdate'),
  onUpdateStatus(callback) {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => callback(status)
    ipcRenderer.on('arete:update', listener)
    return () => ipcRenderer.removeListener('arete:update', listener)
  },
  logHabit: call('logHabit'),
  startHabit: call('startHabit'),
  previewProgression: call('previewProgression'),
  routineExercises: call('routineExercises'),
  copyDiagnostics: call('copyDiagnostics'),
  logWindowError: call('logWindowError'),
  applyProgression: call('applyProgression'),
  syncNow: call('syncNow'),
  onSynced(callback) {
    const listener = (_event: Electron.IpcRendererEvent, report: SyncReport) => callback(report)
    ipcRenderer.on('arete:synced', listener)
    return () => ipcRenderer.removeListener('arete:synced', listener)
  }
}

contextBridge.exposeInMainWorld('arete', api)

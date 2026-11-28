// "Copy diagnostics": what someone helping you needs, as text to paste into a
// chat with Claude. Nothing private: no keys or tokens (only whether each is
// saved), no meal descriptions, weights, habit or goal names, or notes; counts,
// settings about how Arete behaves, recent sync results, and the log's tail.
import { app } from 'electron'
import type { Repo } from './repo.ts'
import type { Settings } from './settings.ts'
import { logTail } from './log.ts'
import { getUpdateStatus } from './updater.ts'

export function diagnostics(settings: Settings, repo: Repo): string {
  const s = settings.public()
  const acts = repo.allActivities()
  const bySource: Record<string, number> = {}
  const byKind: Record<string, number> = {}
  for (const a of acts) {
    bySource[a.source] = (bySource[a.source] ?? 0) + 1
    byKind[a.kind] = (byKind[a.kind] ?? 0) + 1
  }
  const dates = acts.map((a) => a.date).sort()
  const hevy = acts.filter((a) => a.source === 'hevy')
  const lastProgress = s.progressLog.at(-1)
  const info = {
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: `${process.platform} ${process.arch}`,
    electron: process.versions.electron,
    node: process.versions.node,
    update: getUpdateStatus(),
    keysSaved: s.secrets,
    canEncrypt: s.canEncrypt,
    settings: {
      units: s.units,
      themeMode: s.themeMode,
      openAtLogin: s.openAtLogin,
      habitsFromTodoist: s.habitTasks,
      recoveryUntil: s.recoveryUntil,
      progression: { enabled: s.progression.enabled, stepKg: Math.round(s.progression.stepKg * 1000) / 1000, customRanges: Object.keys(s.progression.ranges).length },
      program: s.program ? { weeks: s.program.weeks, start: s.program.start, kind: s.program.kind } : null
    },
    counts: {
      activities: acts.length,
      activitiesBySource: bySource,
      activitiesByKind: byKind,
      firstActivity: dates[0] ?? null,
      lastActivity: dates.at(-1) ?? null,
      hevyDetailVersions: [...new Set(hevy.map((a) => a.detail.liftsVersion ?? 0))],
      habits: {
        total: s.habits.length,
        active: s.habits.filter((h) => h.active).length,
        queued: s.habits.filter((h) => h.queued).length,
        linkedToTodoist: s.habits.filter((h) => (h.todoistTaskIds ?? []).length).length
      },
      goals: {
        total: s.liftGoals.length,
        withExercise: s.liftGoals.filter((g) => g.exercise).length,
        metrics: s.liftGoals.map((g) => g.metric)
      }
    },
    lastSync: s.lastSync,
    lastProgression: lastProgress ? { at: lastProgress.at, changes: lastProgress.changes.length } : null
  }
  const log = logTail(200)
  return [
    `Arete ${info.version} diagnostics (${new Date().toString()})`,
    '```json',
    JSON.stringify(info, null, 2),
    '```',
    `Log (last ${log.length} lines)`,
    '```',
    ...log,
    '```'
  ].join('\n')
}

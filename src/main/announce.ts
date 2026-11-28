// Windows notifications for new personal records and habit milestones.
import { Notification } from 'electron'
import { addDays, morningTrend, toLocalDate, KG_PER_LB } from '../shared/logic.ts'
import { habitStatus } from '../shared/habits.ts'
import { findWins } from '../shared/wins.ts'
import type { Repo } from './repo.ts'
import type { Settings } from './settings.ts'

/** Announces new records and habit milestones from the last two days, once each. */
export function announceWins(settings: Settings, repo: Repo): void {
  if (!Notification.isSupported()) return
  const today = toLocalDate(new Date())
  const activities = repo.allActivities()
  const trend = morningTrend(repo.listWeights('1900-01-01', today), 7).trend
  const statuses = settings.habits.filter((h) => !h.queued).map((h) => habitStatus(h, activities, today))
  const units = settings.public().units
  const fmt = (kg: number) => (units === 'lb' ? `${(kg / KG_PER_LB).toFixed(1)} lb` : `${kg.toFixed(1)} kg`)
  const fresh = findWins(activities, trend, statuses, fmt, addDays(today, -1)).filter((w) => !settings.wasNotified(w.id))
  for (const w of fresh.slice(0, 3)) new Notification({ title: w.title, body: w.detail, silent: true }).show()
  settings.markNotified(fresh.map((w) => w.id))
}

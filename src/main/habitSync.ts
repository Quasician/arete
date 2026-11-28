// Keeps habits, Todoist and Arete in step:
// - each scheduled habit gets a Todoist task for today, at its cue time, so Praxis shows it;
// - doing the habit (synced or logged in Arete) closes the task;
// - ticking the task in Todoist or Praxis logs the habit in Arete;
// - undone tasks from earlier days are tidied away instead of piling up as overdue;
// - on Sundays, the weekly review goes in Todoist too.
import { addDays, toLocalDate, weekStartOf } from '../shared/logic.ts'
import { doneLevel, isScheduled, type Habit } from '../shared/habits.ts'
import { reviewText, weeklyReview } from '../shared/review.ts'
import type { Repo } from './repo.ts'
import type { Settings } from './settings.ts'
import { Todoist } from './todoist.ts'

const PROJECT = 'Arete habits'

export function inRecovery(settings: Settings, today: string): boolean {
  return !!settings.recoveryUntil && today <= settings.recoveryUntil
}

export function habitTaskTitle(h: Habit, recovery: boolean): string {
  return recovery ? `${h.name}: ${h.minimumMinutes} min (recovery week)` : `${h.name}: ${h.fullMinutes} min (minimum ${h.minimumMinutes})`
}

function describe(h: Habit, recovery: boolean): string {
  const plan = `${h.cue}${h.time ? `, around ${h.time}` : ''}.`
  return recovery
    ? `${plan} Recovery week: the ${h.minimumMinutes}-minute version is the whole goal. Logged by Arete.`
    : `${plan} The ${h.minimumMinutes}-minute minimum still counts. Logged by Arete.`
}

let running: Promise<string | null> | null = null

/** Runs one pass. Returns an error message for the UI, or null. Safe to call often. */
export function syncHabitTasks(settings: Settings, repo: Repo, now = new Date()): Promise<string | null> {
  if (running) return running
  running = (async () => {
    const token = settings.getSecret('todoist')
    if (!token || !settings.habitTasks) return null
    const td = new Todoist(token)
    const today = toLocalDate(now)
    const habits = settings.habits.filter((h) => h.active)
    const activities = repo.allActivities()
    try {
      // 1. Ticked in Todoist or Praxis since yesterday: log it in Arete.
      const open = repo.openHabitTasks()
      if (open.length) {
        const since = new Date(now.getTime() - 2 * 86_400_000)
        const done = await td.completedIds(since, new Date(now.getTime() + 60_000))
        for (const row of open) {
          if (!done.has(row.taskId)) continue
          const h = settings.habits.find((x) => x.id === row.habitId)
          if (h && doneLevel(h, row.date, activities) === 'none') {
            const minutes = inRecovery(settings, row.date) ? h.minimumMinutes : h.fullMinutes
            repo.addActivity({ kind: h.kind, date: row.date, title: h.name, durationSec: minutes * 60 })
          }
          repo.saveHabitTask(row.habitId, row.date, row.taskId, 'closed')
        }
      }
      const fresh = repo.allActivities()

      // 2. Done in Arete: close the task. Left undone on an earlier day: remove it.
      for (const row of repo.openHabitTasks()) {
        const h = settings.habits.find((x) => x.id === row.habitId)
        if (h && doneLevel(h, row.date, fresh) !== 'none') {
          await td.closeTask(row.taskId).catch(() => undefined)
          repo.saveHabitTask(row.habitId, row.date, row.taskId, 'closed')
        } else if (!h || row.date < today) {
          await td.deleteTask(row.taskId)
          repo.saveHabitTask(row.habitId, row.date, row.taskId, 'removed')
        }
      }

      // 3. Today's habits that aren't done yet and have no task: create one.
      const todo = habits.filter((h) => isScheduled(h, today) && !repo.habitTask(h.id, today) && doneLevel(h, today, fresh) === 'none')
      if (todo.length) {
        const projectId = await td.projectId(PROJECT)
        const recovery = inRecovery(settings, today)
        for (const h of todo) {
          const task = await td.createTask({
            content: habitTaskTitle(h, recovery),
            description: describe(h, recovery),
            projectId,
            dueString: h.time ? `today at ${h.time}` : 'today',
            durationMinutes: recovery ? h.minimumMinutes : h.fullMinutes
          })
          repo.saveHabitTask(h.id, today, task.id, 'open')
        }
      }

      // 4. Sunday: last full week's review, once.
      const thisWeek = weekStartOf(today)
      const isSunday = addDays(thisWeek, 6) === today
      if (isSunday && habits.length && settings.lastReviewWeek !== thisWeek) {
        const review = weeklyReview(habits, fresh, thisWeek, today)
        const projectId = await td.projectId(PROJECT)
        await td.createTask({ content: 'Arete weekly review', description: reviewText(review), projectId, dueString: 'today' })
        settings.setLastReviewWeek(thisWeek)
      }
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  })().finally(() => {
    running = null
  })
  return running
}

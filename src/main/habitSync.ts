// Keeps habits, Todoist and Arete in step. Todoist is where habits live:
// - every task labelled @habit becomes a habit (recurring ones are active,
//   undated ones wait in the queue); Arete never makes daily copies;
// - ticking a habit's task in Todoist or Praxis logs it in Arete;
// - doing the habit (synced from Hevy or Concept2, or ticked in Arete) closes
//   the task, which moves it to its next date;
// - a habit made in Arete gets one recurring @habit task in the Inbox;
// - on Sundays, the weekly review goes in the Inbox.
import { addDays, toLocalDate, weekStartOf } from '../shared/logic.ts'
import { doneLevel, type Habit } from '../shared/habits.ts'
import { HABIT_LABEL, dueStringFor, mergeTodoistHabits, taskDueOn } from '../shared/todoistHabits.ts'
import { reviewText, weeklyReview } from '../shared/review.ts'
import type { Repo } from './repo.ts'
import type { Settings } from './settings.ts'
import { Todoist } from './todoist.ts'

export function inRecovery(settings: Settings, today: string): boolean {
  return !!settings.recoveryUntil && today <= settings.recoveryUntil
}

function linked(h: Habit): boolean {
  return (h.todoistTaskIds ?? []).length > 0
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
    try {
      // 1. Habits from @habit tasks. Read and write in one step so edits made in
      //    the window meanwhile aren't overwritten.
      const tasks = await td.habitTasks()
      const merged = mergeTodoistHabits(settings.habits, tasks, today)
      if (JSON.stringify(merged.habits) !== JSON.stringify(settings.habits)) settings.update({ habits: merged.habits })

      // 2. Tidy away the one-off daily tasks earlier versions made.
      for (const row of repo.openHabitTasks()) {
        await td.deleteTask(row.taskId)
        repo.saveHabitTask(row.habitId, row.date, row.taskId, 'removed')
      }

      // 3. Ticked in Todoist or Praxis: log it here.
      const byTask = new Map<string, Habit>()
      for (const h of settings.habits) for (const id of h.todoistTaskIds ?? []) byTask.set(id, h)
      if (byTask.size) {
        const done = await td.completions(new Date(now.getTime() - 3 * 86_400_000))
        for (const c of done.sort((a, b) => a.at.localeCompare(b.at))) {
          const h = byTask.get(c.taskId)
          if (!h) continue
          const date = toLocalDate(new Date(c.at))
          if (date < h.startDate || date > today || repo.habitTask(h.id, date)) continue
          if (doneLevel(h, date, repo.listActivities(date, date)) === 'none') {
            const minutes = inRecovery(settings, date) ? h.minimumMinutes : h.fullMinutes
            repo.addHabitCheckIn(h.kind, date, h.name, minutes)
          }
          repo.saveHabitTask(h.id, date, c.taskId, 'closed')
        }
      }

      // 4. Done here (or synced from Hevy or Concept2): tick its task, which moves it on.
      const todays = repo.listActivities(today, today)
      for (const h of settings.habits.filter((x) => x.active && linked(x))) {
        if (repo.habitTask(h.id, today) || doneLevel(h, today, todays) === 'none') continue
        const task = taskDueOn(tasks, h.todoistTaskIds!, today)
        if (!task) continue
        await td.closeTask(task.id)
        repo.saveHabitTask(h.id, today, task.id, 'closed')
      }

      // 5. Habits made in Arete get one recurring task, so Praxis can plan around them.
      for (const h of settings.habits.filter((x) => x.active && !x.queued && !linked(x) && x.days.length)) {
        const task = await td.createTask({
          content: h.name,
          description: `${h.cue}. The ${h.minimumMinutes}-minute minimum still counts. Tracked in Arete.`,
          dueString: dueStringFor(h.days, h.time, h.startDate > today ? h.startDate : undefined),
          durationMinutes: h.fullMinutes,
          labels: [HABIT_LABEL]
        })
        settings.update({ habits: settings.habits.map((x) => (x.id === h.id ? { ...x, todoistTaskIds: [task.id] } : x)) })
      }

      // 6. Sunday: last full week's review, once.
      const habits = settings.habits.filter((h) => h.active)
      const thisWeek = weekStartOf(today)
      if (addDays(thisWeek, 6) === today && habits.length && settings.lastReviewWeek !== thisWeek) {
        const review = weeklyReview(habits, repo.allActivities(), thisWeek, today)
        await td.createTask({ content: 'Arete weekly review', description: reviewText(review), dueString: 'today' })
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

/**
 * Starts a queued habit: gives its Todoist task its days and time (or, for a
 * habit with no task, just starts it here).
 */
export async function startQueuedHabit(
  settings: Settings,
  habitId: string,
  plan: { days: number[]; time: string | null; startDate: string; fullMinutes: number }
): Promise<void> {
  const h = settings.habits.find((x) => x.id === habitId)
  if (!h || !h.queued) throw new Error('That habit is not in the queue.')
  const ids = h.todoistTaskIds ?? []
  const token = settings.getSecret('todoist')
  if (ids.length && token && settings.habitTasks) {
    await new Todoist(token).updateTask(ids[0], {
      dueString: dueStringFor(plan.days, plan.time, plan.startDate),
      durationMinutes: plan.fullMinutes
    })
  }
  settings.update({
    habits: settings.habits.map((x) =>
      x.id === habitId
        ? {
            ...x,
            queued: false,
            active: true,
            days: [...plan.days].sort(),
            time: plan.time,
            startDate: plan.startDate,
            fullMinutes: plan.fullMinutes,
            minimumMinutes: Math.min(x.minimumMinutes, plan.fullMinutes),
            pauses: []
          }
        : x
    )
  })
}

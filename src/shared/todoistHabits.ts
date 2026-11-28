// Habits come from Todoist: every task labelled @habit. Recurring tasks are
// active habits (their days, time and length come from the task); undated
// ones wait in the "Up next" queue. Tasks that share a name before a colon
// ("Lifting: Upper 1", "Lifting: Lower 1") are one habit.
// Pure functions, so they can be tested without Todoist.

import { type Habit } from './habits.ts'
import type { ActivityKind } from './types.ts'

export const HABIT_LABEL = 'habit'

export interface TodoistHabitTask {
  id: string
  content: string
  labels?: string[]
  due?: { date: string; string?: string; is_recurring?: boolean } | null
  duration?: { amount: number; unit: 'minute' | 'day' } | null
  child_order?: number
}

const DAY_WORDS: [RegExp, number][] = [
  [/\bmon(day)?s?\b/, 0],
  [/\btue(s|sday)?s?\b/, 1],
  [/\bwed(nesday)?s?\b/, 2],
  [/\bthu(rs|rsday|r)?s?\b/, 3],
  [/\bfri(day)?s?\b/, 4],
  [/\bsat(urday)?s?\b/, 5],
  [/\bsun(day)?s?\b/, 6]
]

function weekdayOf(date: string): number {
  return (new Date(`${date.slice(0, 10)}T12:00:00Z`).getUTCDay() + 6) % 7
}

export interface Recurrence {
  days: number[]
  time: string | null
  endDate: string | null
}

/** Reads the parts of a Todoist recurrence that a habit needs. */
export function parseRecurrence(due: { date: string; string?: string }): Recurrence {
  const text = (due.string ?? '').toLowerCase()
  const end = text.match(/\b(?:ending|until)\s+(?:on\s+)?(\d{4}-\d{2}-\d{2})/)
  const rule = text.split(/\b(?:starting|ending|until|from)\b/)[0]

  let time: string | null = null
  const dt = due.date.match(/T(\d{2}):(\d{2})/)
  if (dt) time = `${dt[1]}:${dt[2]}`
  else {
    const at = rule.match(/(?:\bat|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/)
    if (at) {
      let h = Number(at[1]) % 24
      if (at[3] === 'pm' && h < 12) h += 12
      if (at[3] === 'am' && h === 12) h = 0
      time = `${String(h).padStart(2, '0')}:${at[2] ?? '00'}`
    }
  }

  let days: number[] = []
  if (/\b(every\s+(day|night|morning|evening|afternoon)|daily)\b/.test(rule)) days = [0, 1, 2, 3, 4, 5, 6]
  else if (/\bevery\s+(weekday|workday)s?\b/.test(rule)) days = [0, 1, 2, 3, 4]
  else if (/\bevery\s+weekends?\b/.test(rule)) days = [5, 6]
  else {
    const named = rule.replace(/\bat\b.*$/, '')
    days = DAY_WORDS.filter(([re]) => re.test(named)).map(([, d]) => d)
  }
  // "every week", "every 2 weeks", "every month": the weekday it falls on.
  if (days.length === 0) days = [weekdayOf(due.date)]
  return { days, time, endDate: end ? end[1] : null }
}

/** "🧘 Meditation" → "Meditation"; "Lifting: Upper 1" → "Lifting". */
export function habitName(content: string): string {
  const plain = content
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s:'&+/-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  const head = plain.includes(':') ? plain.split(':')[0].trim() : plain
  const name = head || plain || 'Habit'
  return (name.charAt(0).toUpperCase() + name.slice(1)).slice(0, 60)
}

const KIND_WORDS: [RegExp, ActivityKind][] = [
  [/\b(lift|lifting|weights?|upper|lower|strength|gym)\b/, 'lift'],
  [/\b(row|rowing|erg)\b/, 'row'],
  [/\b(walk|walking|steps)\b/, 'walk'],
  [/\b(run|running|jog)\b/, 'run'],
  [/\b(climb|climbing|boulder)/, 'climb'],
  [/\b(hike|hiking)\b/, 'hike'],
  [/\b(meditat\w*|mindful\w*|breath\w*)\b/, 'meditate'],
  [/\b(stretch\w*|yoga|mobility)\b/, 'stretch'],
  [/\bpiano\b/, 'piano'],
  [/\b(music|production|produc\w*|beat\w*|daw|compos\w*)\b/, 'music'],
  [/\b(art|draw\w*|paint\w*|sketch\w*)\b/, 'art']
]

export function guessKind(content: string): ActivityKind {
  const text = content.toLowerCase()
  return KIND_WORDS.find(([re]) => re.test(text))?.[1] ?? 'other'
}

const DEFAULT_CUES: Partial<Record<ActivityKind, string>> = {
  lift: 'After I get home from work',
  row: 'After my alarm, before breakfast',
  walk: 'After I wake up',
  meditate: 'Right before bed',
  stretch: 'After my workout',
  art: 'After dinner',
  music: 'After dinner',
  piano: 'After dinner'
}

function defaultCue(kind: ActivityKind, time: string | null): string {
  return DEFAULT_CUES[kind] ?? (time ? `At ${time}` : 'At a set time each day')
}

function minutesOf(t: TodoistHabitTask): number | null {
  if (!t.duration || t.duration.unit !== 'minute') return null
  return Math.min(600, Math.max(1, Math.round(t.duration.amount)))
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'habit'
}

/** The default minimum version: about a fifth of the full one, at least two minutes. */
export function defaultMinimum(full: number): number {
  return Math.min(full, Math.max(2, Math.round(full / 5)))
}

export interface HabitMerge {
  habits: Habit[]
  added: string[]
  paused: string[]
}

/**
 * Merges @habit tasks into the habit list. Todoist decides names, days, times,
 * lengths and end dates; Arete keeps the cue, minimum version, type, history
 * and queue order. Habits whose tasks are gone are paused, never deleted.
 */
export function mergeTodoistHabits(existing: Habit[], tasks: TodoistHabitTask[], today: string): HabitMerge {
  const groups = new Map<string, { name: string; tasks: TodoistHabitTask[] }>()
  for (const t of tasks) {
    if (!(t.labels ?? []).some((l) => l.toLowerCase() === HABIT_LABEL)) continue
    const name = habitName(t.content)
    const key = name.toLowerCase()
    const g = groups.get(key) ?? { name, tasks: [] }
    g.tasks.push(t)
    groups.set(key, g)
  }

  const habits = existing.map((h) => ({ ...h }))
  const claimed = new Set<string>()
  const added: string[] = []
  const paused: string[] = []
  let nextQueue = Math.max(0, ...habits.map((h) => (h.queued ? (h.queueOrder ?? 0) + 1 : 0)))

  for (const g of [...groups.values()].sort((a, b) => (a.tasks[0].child_order ?? 0) - (b.tasks[0].child_order ?? 0))) {
    const ids = g.tasks.map((t) => t.id)
    const kind = guessKind(g.tasks.map((t) => t.content).join(' '))
    // Match: already linked, or an Arete habit of the same name or type made before linking.
    let h =
      habits.find((x) => !claimed.has(x.id) && (x.todoistTaskIds ?? []).some((id) => ids.includes(id))) ??
      habits.find((x) => !claimed.has(x.id) && !(x.todoistTaskIds ?? []).length && x.name.toLowerCase() === g.name.toLowerCase()) ??
      habits.find((x) => !claimed.has(x.id) && !(x.todoistTaskIds ?? []).length && !x.queued && x.kind === kind && kind !== 'other')

    const recurring = g.tasks.filter((t) => t.due?.is_recurring)
    if (recurring.length) {
      const recs = recurring.map((t) => parseRecurrence(t.due!))
      const days = [...new Set(recs.flatMap((r) => r.days))].sort()
      const times = recs.map((r) => r.time).filter((x): x is string => !!x).sort()
      const full = Math.max(...recurring.map((t) => minutesOf(t) ?? 0)) || h?.fullMinutes || 30
      const ends = recs.map((r) => r.endDate)
      const endDate = ends.every((e) => e) ? (ends as string[]).sort().at(-1)! : null
      const firstDue = recurring.map((t) => t.due!.date.slice(0, 10)).sort()[0]
      if (!h) {
        h = {
          id: `td-${slug(g.name)}`,
          name: g.name,
          kind,
          days,
          cue: defaultCue(kind, times[0] ?? null),
          time: times[0] ?? null,
          fullMinutes: full,
          minimumMinutes: defaultMinimum(full),
          startDate: firstDue > today ? firstDue : today,
          active: true
        }
        while (habits.some((x) => x.id === h!.id)) h.id = `${h.id}-${Math.random().toString(36).slice(2, 5)}`
        habits.push(h)
        added.push(g.name)
      } else if (h.queued) {
        // Started from the queue (it was given a recurring date in Todoist).
        h.queued = false
        h.active = true
        h.startDate = firstDue > today ? firstDue : today
        h.pauses = []
      } else if (!h.active) {
        const open = (h.pauses ?? []).findIndex((p) => p.to === null)
        h.active = true
        if (open >= 0) h.pauses = h.pauses!.map((p, i) => (i === open ? { ...p, to: today } : p)).filter((p) => p.to! > p.from)
        else h.startDate = today
      }
      Object.assign(h, {
        name: g.name,
        days,
        time: times[0] ?? null,
        fullMinutes: full,
        minimumMinutes: Math.min(h.minimumMinutes, full),
        endDate,
        todoistTaskIds: ids
      })
      claimed.add(h.id)
    } else {
      // No recurring date yet: waiting in the queue.
      if (!h) {
        const full = Math.max(...g.tasks.map((t) => minutesOf(t) ?? 0)) || 20
        h = {
          id: `td-${slug(g.name)}`,
          name: g.name,
          kind,
          days: [],
          cue: defaultCue(kind, null),
          time: null,
          fullMinutes: full,
          minimumMinutes: defaultMinimum(full),
          startDate: today,
          active: false,
          queued: true,
          queueOrder: nextQueue++
        }
        while (habits.some((x) => x.id === h!.id)) h.id = `${h.id}-${Math.random().toString(36).slice(2, 5)}`
        habits.push(h)
        added.push(g.name)
      } else if (!h.queued && h.active) {
        // An active habit whose task lost its date: pause it.
        h.active = false
        h.pauses = [...(h.pauses ?? []), { from: today, to: null }]
        paused.push(h.name)
      }
      h.name = g.name
      h.todoistTaskIds = ids
      claimed.add(h.id)
    }
  }

  // Linked habits whose tasks are gone or unlabelled.
  const out: Habit[] = []
  for (const h of habits) {
    if (claimed.has(h.id) || !(h.todoistTaskIds ?? []).length) {
      out.push(h)
      continue
    }
    if (h.queued) continue // never started: nothing to keep
    const next = { ...h, todoistTaskIds: [] }
    if (next.active) {
      next.active = false
      next.pauses = [...(next.pauses ?? []), { from: today, to: null }]
      paused.push(h.name)
    }
    out.push(next)
  }
  return { habits: out, added, paused }
}

const DAY_ABBR = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** A Todoist due string for a habit's days and time, e.g. "every tue, fri at 19:30". */
export function dueStringFor(days: number[], time: string | null, startDate?: string): string {
  const which = days.length === 7 ? 'day' : [...days].sort().map((d) => DAY_ABBR[d]).join(', ')
  return `every ${which}${time ? ` at ${time}` : ''}${startDate ? ` starting ${startDate}` : ''}`
}

/** The task of a habit that is due on a given day (for closing it when the habit is done). */
export function taskDueOn(tasks: TodoistHabitTask[], ids: string[], date: string): TodoistHabitTask | null {
  const due = tasks
    .filter((t) => ids.includes(t.id) && t.due?.is_recurring && t.due.date.slice(0, 10) <= date)
    .sort((a, b) => b.due!.date.localeCompare(a.due!.date))
  // Today's occurrence first; otherwise the latest one left overdue.
  return due.find((t) => t.due!.date.slice(0, 10) === date) ?? due[0] ?? null
}



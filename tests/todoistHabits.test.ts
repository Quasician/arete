import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dueStringFor, guessKind, habitName, mergeTodoistHabits, parseRecurrence, taskDueOn, type TodoistHabitTask } from '../src/shared/todoistHabits.ts'
import type { Habit } from '../src/shared/habits.ts'

test('parseRecurrence reads days, time and end date', () => {
  assert.deepEqual(parseRecurrence({ date: '2026-11-30T16:30:00', string: 'every monday at 4:30pm' }), { days: [0], time: '16:30', endDate: null })
  assert.deepEqual(parseRecurrence({ date: '2027-01-05T19:30:00', string: 'every tue, fri at 7:30pm' }), { days: [1, 4], time: '19:30', endDate: null })
  assert.deepEqual(parseRecurrence({ date: '2026-11-27', string: 'every day' }), { days: [0, 1, 2, 3, 4, 5, 6], time: null, endDate: null })
  assert.deepEqual(parseRecurrence({ date: '2026-11-28T22:15:00', string: 'every day at 10:15pm' }).days.length, 7)
  assert.deepEqual(parseRecurrence({ date: '2026-12-01T07:00:00', string: 'every tuesday at 7am ending 2027-01-12' }), {
    days: [1],
    time: '07:00',
    endDate: '2027-01-12'
  })
  assert.deepEqual(parseRecurrence({ date: '2026-12-01', string: 'every weekday' }).days, [0, 1, 2, 3, 4])
  assert.deepEqual(parseRecurrence({ date: '2026-12-05', string: 'every weekend at 9am' }), { days: [5, 6], time: '09:00', endDate: null })
  // Starting clauses and weekly rules without a day name fall back to the due date's weekday.
  assert.deepEqual(parseRecurrence({ date: '2026-12-04', string: 'every week starting dec 4' }).days, [4])
  assert.equal(parseRecurrence({ date: '2026-12-01', string: 'every month @ 8:00' }).time, '08:00')
})

test('habitName and guessKind read task names', () => {
  assert.equal(habitName('🧘 Meditation'), 'Meditation')
  assert.equal(habitName('Lifting: Upper 1'), 'Lifting')
  assert.equal(habitName('Rowing: long Zone 2'), 'Rowing')
  assert.equal(habitName('🎨 Art practice'), 'Art practice')
  assert.equal(guessKind('Lifting: Upper 1'), 'lift')
  assert.equal(guessKind('Rowing: HIIT'), 'row')
  assert.equal(guessKind('🧘 Meditation'), 'meditate')
  assert.equal(guessKind('🎨 Art practice'), 'art')
  assert.equal(guessKind('🎸 Music practice'), 'music')
  assert.equal(guessKind('Piano scales'), 'piano')
  assert.equal(guessKind('🤸 Longer weekend stretch'), 'stretch')
  assert.equal(guessKind('Daily walk'), 'walk')
})

const TODAY = '2026-11-27'
const rec = (id: string, content: string, date: string, string: string, minutes?: number): TodoistHabitTask => ({
  id,
  content,
  labels: ['habit'],
  due: { date, string, is_recurring: true },
  duration: minutes ? { amount: minutes, unit: 'minute' } : null
})
const tasks: TodoistHabitTask[] = [
  rec('l1', 'Lifting: Upper 1', '2026-11-30T16:30:00', 'every monday at 4:30pm', 60),
  rec('l2', 'Lifting: Lower 1', '2026-12-01T16:30:00', 'every tuesday at 4:30pm', 60),
  rec('l3', 'Lifting: Upper 2', '2026-12-03T16:30:00', 'every thursday at 4:30pm', 60),
  rec('l4', 'Lifting: Lower 2', '2026-12-04T16:30:00', 'every friday at 4:30pm', 60),
  rec('r1', 'Rowing: HIIT', '2026-11-30T07:00:00', 'every monday at 7am ending 2027-01-11', 45),
  rec('r2', 'Rowing: Zone 2', '2026-12-01T07:00:00', 'every tuesday at 7am ending 2027-01-12', 30),
  rec('r3', 'Rowing: long Zone 2', '2026-11-29T07:00:00', 'every sunday at 7am ending 2027-01-17', 60),
  rec('w', 'Daily walk', '2026-11-27', 'every day', 30),
  rec('m', '🧘 Meditation', '2026-11-28T22:15:00', 'every day at 10:15pm', 10),
  rec('a', '🎨 Art practice', '2027-01-05T19:30:00', 'every tue, fri at 7:30pm', 30),
  { id: 'q1', content: '🎸 Music practice', labels: ['deep', 'habit'], due: null, duration: { amount: 30, unit: 'minute' } },
  { id: 'x', content: 'Not a habit', labels: ['light'], due: { date: '2026-11-27', string: 'every day', is_recurring: true } }
]

test('@habit tasks become habits, grouped by the name before a colon', () => {
  const { habits, added } = mergeTodoistHabits([], tasks, TODAY)
  assert.deepEqual(added, ['Lifting', 'Rowing', 'Daily walk', 'Meditation', 'Art practice', 'Music practice'])
  const by = Object.fromEntries(habits.map((h) => [h.name, h]))
  assert.deepEqual(by['Lifting'].days, [0, 1, 3, 4])
  assert.equal(by['Lifting'].time, '16:30')
  assert.equal(by['Lifting'].fullMinutes, 60)
  assert.equal(by['Lifting'].minimumMinutes, 12)
  assert.equal(by['Lifting'].kind, 'lift')
  assert.deepEqual(by['Lifting'].todoistTaskIds, ['l1', 'l2', 'l3', 'l4'])
  assert.deepEqual(by['Rowing'].days, [0, 1, 6])
  assert.equal(by['Rowing'].endDate, '2027-01-17')
  assert.equal(by['Meditation'].kind, 'meditate')
  assert.equal(by['Meditation'].cue, 'Right before bed')
  // Art starts in January; music has no date, so it waits in the queue.
  assert.equal(by['Art practice'].startDate, '2027-01-05')
  assert.equal(by['Art practice'].active, true)
  assert.equal(by['Music practice'].queued, true)
  assert.equal(by['Music practice'].active, false)
  assert.equal(habits.length, 6)
})

test('merging keeps what Arete owns and links habits made in Arete', () => {
  const mine: Habit = {
    id: 'old-lift', name: 'Lifting', kind: 'lift', days: [0, 1, 3, 4], cue: 'When I close the laptop', time: '18:00',
    fullMinutes: 50, minimumMinutes: 15, startDate: '2026-11-01', active: true
  }
  const first = mergeTodoistHabits([mine], tasks, TODAY).habits
  const lift = first.find((h) => h.id === 'old-lift')!
  assert.equal(lift.cue, 'When I close the laptop')
  assert.equal(lift.startDate, '2026-11-01')
  assert.equal(lift.time, '16:30')
  assert.equal(lift.minimumMinutes, 15)
  assert.equal(first.filter((h) => h.kind === 'lift').length, 1)

  // Running again changes nothing.
  assert.deepEqual(mergeTodoistHabits(first, tasks, TODAY).habits, first)

  // The walk task loses its @habit label: the habit is paused, history kept.
  const noWalk = tasks.filter((t) => t.id !== 'w')
  const later = mergeTodoistHabits(first, noWalk, '2026-12-10')
  const walk = later.habits.find((h) => h.name === 'Daily walk')!
  assert.equal(walk.active, false)
  assert.deepEqual(walk.pauses, [{ from: '2026-12-10', to: null }])
  assert.deepEqual(later.paused, ['Daily walk'])
  // Labelled again: resumed, and the pause is closed.
  const back = mergeTodoistHabits(later.habits, tasks, '2026-12-14').habits.find((h) => h.name === 'Daily walk')!
  assert.equal(back.active, true)
  assert.deepEqual(back.pauses, [{ from: '2026-12-10', to: '2026-12-14' }])

  // A queued habit whose task gets a recurring date starts.
  const started = tasks.map((t) => (t.id === 'q1' ? rec('q1', '🎸 Music practice', '2027-02-01T19:30:00', 'every mon, thu at 7:30pm', 30) : t))
  const music = mergeTodoistHabits(first, started, '2027-01-25').habits.find((h) => h.name === 'Music practice')!
  assert.equal(music.queued, false)
  assert.equal(music.active, true)
  assert.equal(music.startDate, '2027-02-01')
  assert.deepEqual(music.days, [0, 3])
})

test('taskDueOn picks today’s occurrence first', () => {
  const ids = ['l1', 'l2', 'l3', 'l4']
  assert.equal(taskDueOn(tasks, ids, '2026-11-30')?.id, 'l1')
  // Monday's was missed (still overdue) and Tuesday's is due: Tuesday's is ticked.
  const overdue = tasks.map((t) => (t.id === 'l1' ? { ...t, due: { ...t.due!, date: '2026-11-30T16:30:00' } } : t))
  assert.equal(taskDueOn(overdue, ids, '2026-12-01')?.id, 'l2')
  assert.equal(taskDueOn(tasks, ids, '2026-11-28'), null)
})

test('dueStringFor writes a Todoist recurrence', () => {
  assert.equal(dueStringFor([4, 1], '19:30'), 'every tue, fri at 19:30')
  assert.equal(dueStringFor([0, 1, 2, 3, 4, 5, 6], null, '2027-01-05'), 'every day starting 2027-01-05')
})

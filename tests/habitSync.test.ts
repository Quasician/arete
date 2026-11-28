import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import type { Habit } from '../src/shared/habits.ts'

// A fake Todoist that records what Arete asks of it.
interface FakeTask {
  id: string
  content: string
  description?: string
  labels: string[]
  due: { date: string; string: string; is_recurring: boolean } | null
  duration: { amount: number; unit: 'minute' } | null
  checked?: boolean
  deleted?: boolean
}
const tasks: FakeTask[] = []
const events: { object_id: string; event_date: string; event_type: string }[] = []
const calls: string[] = []

const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const url = new URL(req.url!, 'http://x')
    const send = (status: number, data?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(data === undefined ? '' : JSON.stringify(data))
    }
    if (req.headers.authorization !== 'Bearer test-token') return send(401)
    calls.push(`${req.method} ${url.pathname}`)
    if (req.method === 'GET' && url.pathname === '/tasks/filter') {
      assert.equal(url.searchParams.get('query'), '@habit')
      return send(200, { results: tasks.filter((t) => !t.deleted && !t.checked && t.labels.includes('habit')), next_cursor: null })
    }
    if (req.method === 'GET' && url.pathname === '/activities') {
      assert.equal(url.searchParams.get('event_type'), 'completed')
      return send(200, { results: events, next_cursor: null })
    }
    if (req.method === 'POST' && url.pathname === '/tasks') {
      const b = JSON.parse(body)
      const t: FakeTask = {
        id: `n${tasks.length + 1}`,
        content: b.content,
        description: b.description,
        labels: b.labels ?? [],
        due: { date: '2026-11-30', string: b.due_string, is_recurring: b.due_string.startsWith('every') },
        duration: b.duration ? { amount: b.duration, unit: 'minute' } : null
      }
      tasks.push(t)
      return send(200, t)
    }
    const close = url.pathname.match(/^\/tasks\/([^/]+)\/close$/)
    if (req.method === 'POST' && close) {
      const t = tasks.find((x) => x.id === close[1])!
      // A recurring task moves to its next date (a week on, in this fake) and logs a completion.
      events.push({ object_id: t.id, event_date: '2026-11-30T17:40:00Z', event_type: 'completed' })
      if (t.due?.is_recurring) t.due = { ...t.due, date: '2026-12-07T16:30:00' }
      else t.checked = true
      return send(204)
    }
    const one = url.pathname.match(/^\/tasks\/([^/]+)$/)
    if (req.method === 'POST' && one) {
      const t = tasks.find((x) => x.id === one[1])!
      const b = JSON.parse(body)
      if (b.due_string) t.due = { date: '2027-01-05T19:30:00', string: b.due_string, is_recurring: true }
      if (b.duration) t.duration = { amount: b.duration, unit: 'minute' }
      return send(200, t)
    }
    if (req.method === 'DELETE' && one) {
      const t = tasks.find((x) => x.id === one[1])
      if (!t) return send(404)
      t.deleted = true
      return send(204)
    }
    send(404)
  })
})

function fakeSettings(habits: Habit[]) {
  return {
    habits,
    habitTasks: true,
    recoveryUntil: null as string | null,
    lastReviewWeek: null as string | null,
    getSecret: (name: string) => (name === 'todoist' ? 'test-token' : null),
    update(patch: { habits?: Habit[] }) {
      if (patch.habits) this.habits = patch.habits
    },
    setLastReviewWeek(week: string) {
      this.lastReviewWeek = week
    }
  }
}

test('habits follow @habit tasks: ticks flow both ways, no daily copies', async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  process.env['ARETE_TODOIST_BASE'] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const { syncHabitTasks, startQueuedHabit } = await import('../src/main/habitSync.ts')
  const { Store } = await import('../src/main/db.ts')
  const { Repo } = await import('../src/main/repo.ts')
  const require = createRequire(import.meta.url)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arete-habits-'))
  const store = await Store.open(path.join(dir, 'a.sqlite'), require.resolve('sql.js/dist/sql-wasm.wasm'))
  const repo = new Repo(store)

  tasks.push(
    { id: 'l1', content: 'Lifting: Upper 1', labels: ['habit'], due: { date: '2026-11-30T16:30:00', string: 'every monday at 4:30pm', is_recurring: true }, duration: { amount: 60, unit: 'minute' } },
    { id: 'l2', content: 'Lifting: Lower 1', labels: ['habit'], due: { date: '2026-12-01T16:30:00', string: 'every tuesday at 4:30pm', is_recurring: true }, duration: { amount: 60, unit: 'minute' } },
    { id: 'w', content: 'Daily walk', labels: ['habit', 'light'], due: { date: '2026-11-30', string: 'every day', is_recurring: true }, duration: { amount: 30, unit: 'minute' } },
    { id: 'm', content: '🎸 Music practice', labels: ['habit'], due: null, duration: { amount: 30, unit: 'minute' } }
  )
  // An Arete-only habit (from before Todoist was connected) and an old one-off daily task.
  const stretch: Habit = {
    id: 'stretch', name: 'Stretch', kind: 'stretch', days: [5, 6], cue: 'After my walk', time: '09:00',
    fullMinutes: 15, minimumMinutes: 3, startDate: '2026-11-01', active: true
  }
  const settings = fakeSettings([stretch])
  tasks.push({ id: 'old', content: 'Stretch: 15 min (minimum 3)', labels: [], due: { date: '2026-11-29', string: 'today', is_recurring: false }, duration: null })
  repo.saveHabitTask('stretch', '2026-11-29', 'old', 'open')

  try {
    // Monday Nov 30, 6 AM.
    const monday = new Date(2026, 10, 30, 6, 0)
    assert.equal(await syncHabitTasks(settings as never, repo, monday), null)
    const names = settings.habits.map((h) => h.name).sort()
    assert.deepEqual(names, ['Daily walk', 'Lifting', 'Music practice', 'Stretch'])
    assert.equal(settings.habits.find((h) => h.name === 'Music practice')!.queued, true)
    // The old one-off is deleted; the Arete-only habit got one recurring @habit task.
    assert.equal(tasks.find((t) => t.id === 'old')!.deleted, true)
    const made = tasks.find((t) => t.content === 'Stretch')!
    assert.deepEqual(made.labels, ['habit'])
    assert.equal(made.due!.string, 'every sat, sun at 09:00')
    assert.deepEqual(settings.habits.find((h) => h.id === 'stretch')!.todoistTaskIds, [made.id])
    // No daily copies, no Arete project.
    assert.equal(calls.filter((c) => c === 'POST /tasks').length, 1)
    assert.ok(!calls.some((c) => c.includes('/projects')))

    // The walk is ticked in Praxis: Arete logs it, once.
    events.push({ object_id: 'w', event_date: new Date(2026, 10, 30, 7, 0).toISOString(), event_type: 'completed' })
    await syncHabitTasks(settings as never, repo, new Date(2026, 10, 30, 8, 0))
    await syncHabitTasks(settings as never, repo, new Date(2026, 10, 30, 8, 5))
    const walks = repo.listActivities('2026-11-30', '2026-11-30').filter((a) => a.kind === 'walk')
    assert.equal(walks.length, 1)
    assert.equal(walks[0].source, 'habit')
    assert.equal(walks[0].durationSec, 30 * 60)

    // Lifting synced from Hevy: Monday's lifting task is ticked (and moves to next week).
    repo.upsertSynced({ kind: 'lift', source: 'hevy', externalId: 'hv1', date: '2026-11-30', startedAt: null, title: 'Upper 1', durationSec: 3500, distanceM: null, detail: {} })
    await syncHabitTasks(settings as never, repo, new Date(2026, 10, 30, 18, 0))
    assert.equal(tasks.find((t) => t.id === 'l1')!.due!.date, '2026-12-07T16:30:00')
    assert.equal(tasks.find((t) => t.id === 'l2')!.due!.date, '2026-12-01T16:30:00')
    // Its own completion event doesn't log a second lift.
    await syncHabitTasks(settings as never, repo, new Date(2026, 10, 30, 18, 5))
    assert.equal(repo.listActivities('2026-11-30', '2026-11-30').filter((a) => a.kind === 'lift').length, 1)

    // A Hevy workout replaces a check-in for the same day, so time isn't counted twice.
    repo.addHabitCheckIn('lift', '2026-12-01', 'Lifting', 60)
    repo.upsertSynced({ kind: 'lift', source: 'hevy', externalId: 'hv2', date: '2026-12-01', startedAt: null, title: 'Lower 1', durationSec: 3300, distanceM: null, detail: {} })
    const tue = repo.listActivities('2026-12-01', '2026-12-01')
    assert.deepEqual(tue.map((a) => a.source), ['hevy'])

    // Starting the queued habit gives its task days and a time.
    const music = settings.habits.find((h) => h.name === 'Music practice')!
    await startQueuedHabit(settings as never, music.id, { days: [1, 4], time: '19:30', startDate: '2027-01-05', fullMinutes: 30 })
    assert.equal(tasks.find((t) => t.id === 'm')!.due!.string, 'every tue, fri at 19:30 starting 2027-01-05')
    const started = settings.habits.find((h) => h.id === music.id)!
    assert.equal(started.queued, false)
    assert.equal(started.active, true)
    await syncHabitTasks(settings as never, repo, new Date(2026, 11, 2, 6, 0))
    assert.equal(settings.habits.find((h) => h.id === music.id)!.queued, false)

    // Sunday: the weekly review goes to the Inbox (no project).
    await syncHabitTasks(settings as never, repo, new Date(2026, 11, 6, 9, 0))
    assert.ok(tasks.some((t) => t.content === 'Arete weekly review'))
    assert.equal(settings.lastReviewWeek, '2026-11-30')
  } finally {
    store.close()
    server.close()
  }
})

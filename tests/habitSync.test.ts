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
  description: string
  due_string: string
  duration?: number
  closed: boolean
  deleted: boolean
}
const tasks: FakeTask[] = []
const projects: { id: string; name: string }[] = [{ id: 'inbox', name: 'Inbox' }]
const completedIds = new Set<string>()

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
    if (req.method === 'GET' && url.pathname === '/projects') return send(200, { results: projects, next_cursor: null })
    if (req.method === 'POST' && url.pathname === '/projects') {
      const p = { id: `p${projects.length}`, name: JSON.parse(body).name }
      projects.push(p)
      return send(200, p)
    }
    if (req.method === 'POST' && url.pathname === '/tasks') {
      const b = JSON.parse(body)
      const t: FakeTask = { id: `t${tasks.length + 1}`, content: b.content, description: b.description, due_string: b.due_string, duration: b.duration, closed: false, deleted: false }
      tasks.push(t)
      return send(200, { id: t.id, content: t.content })
    }
    const close = url.pathname.match(/^\/tasks\/([^/]+)\/close$/)
    if (req.method === 'POST' && close) {
      tasks.find((t) => t.id === close[1])!.closed = true
      return send(204)
    }
    const one = url.pathname.match(/^\/tasks\/([^/]+)$/)
    if (req.method === 'DELETE' && one) {
      const t = tasks.find((x) => x.id === one[1])
      if (!t) return send(404)
      t.deleted = true
      return send(204)
    }
    if (req.method === 'GET' && url.pathname === '/tasks/completed/by_completion_date') {
      return send(200, { items: [...completedIds].map((id) => ({ id, completed_at: new Date().toISOString() })), next_cursor: null })
    }
    send(404)
  })
})

const walk: Habit = {
  id: 'walk', name: 'Daily walk', kind: 'walk', days: [0, 1, 2, 3, 4, 5, 6], cue: 'After my morning coffee',
  time: '06:30', fullMinutes: 30, minimumMinutes: 10, startDate: '2026-11-01', active: true
}
const row: Habit = { ...walk, id: 'row', name: 'Morning row', kind: 'row', time: '07:00', fullMinutes: 25, minimumMinutes: 5 }

function fakeSettings(habits: Habit[]) {
  return {
    habits,
    habitTasks: true,
    recoveryUntil: null as string | null,
    lastReviewWeek: null as string | null,
    getSecret: (name: string) => (name === 'todoist' ? 'test-token' : null),
    setLastReviewWeek(week: string) {
      this.lastReviewWeek = week
    }
  }
}

test('habit tasks: created, closed when done, logged when ticked, tidied when missed', async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  process.env['ARETE_TODOIST_BASE'] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const { syncHabitTasks } = await import('../src/main/habitSync.ts')
  const { Store } = await import('../src/main/db.ts')
  const { Repo } = await import('../src/main/repo.ts')
  const require = createRequire(import.meta.url)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arete-habits-'))
  const store = await Store.open(path.join(dir, 'a.sqlite'), require.resolve('sql.js/dist/sql-wasm.wasm'))
  const repo = new Repo(store)
  const settings = fakeSettings([walk, row])
  try {
    // Friday Nov 27, 5 AM local: both habits get tasks at their cue times, in a new project.
    const friday = new Date(2026, 10, 27, 5, 0)
    assert.equal(await syncHabitTasks(settings as never, repo, friday), null)
    assert.equal(tasks.length, 2)
    assert.ok(projects.some((p) => p.name === 'Arete habits'))
    assert.deepEqual(tasks.map((t) => [t.content, t.due_string, t.duration]), [
      ['Daily walk: 30 min (minimum 10)', 'today at 06:30', 30],
      ['Morning row: 25 min (minimum 5)', 'today at 07:00', 25]
    ])
    // Running again creates nothing new.
    await syncHabitTasks(settings as never, repo, friday)
    assert.equal(tasks.length, 2)

    // The row syncs from Concept2: its task closes.
    repo.addActivity({ kind: 'row', date: '2026-11-27', durationSec: 1500 })
    // The walk is ticked in Praxis: Arete logs it.
    completedIds.add('t1')
    await syncHabitTasks(settings as never, repo, new Date(2026, 10, 27, 9, 0))
    assert.equal(tasks[1].closed, true)
    const walks = repo.listActivities('2026-11-27', '2026-11-27').filter((a) => a.kind === 'walk')
    assert.equal(walks.length, 1)
    assert.equal(walks[0].durationSec, 30 * 60)

    // Saturday: new tasks; nothing from Friday is left open.
    completedIds.clear()
    await syncHabitTasks(settings as never, repo, new Date(2026, 10, 28, 5, 0))
    assert.equal(tasks.length, 4)
    // Saturday's walk is never done; on Sunday its task is removed rather than left overdue,
    // and Sunday brings the weekly review.
    await syncHabitTasks(settings as never, repo, new Date(2026, 10, 29, 5, 0))
    assert.equal(tasks[2].deleted, true)
    assert.ok(tasks.some((t) => t.content === 'Arete weekly review'))
    assert.equal(settings.lastReviewWeek, '2026-11-23')

    // Recovery week: tasks ask only for the minimum.
    settings.recoveryUntil = '2026-12-06'
    await syncHabitTasks(settings as never, repo, new Date(2026, 10, 30, 5, 0))
    assert.ok(tasks.some((t) => t.content === 'Daily walk: 10 min (recovery week)' && t.duration === 10))
  } finally {
    store.close()
    server.close()
  }
})

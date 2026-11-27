import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Store } from '../src/main/db.ts'
import { Repo } from '../src/main/repo.ts'

const require = createRequire(import.meta.url)
const wasm = require.resolve('sql.js/dist/sql-wasm.wasm')

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arete-test-'))
  const file = path.join(dir, 'arete.sqlite')
  const store = await Store.open(file, wasm)
  return { dir, file, store, repo: new Repo(store) }
}

test('data survives closing and reopening the database', async () => {
  const { file, store, repo } = await fresh()
  repo.addActivity({ kind: 'climb', date: '2026-11-25' })
  repo.addWeight({ date: '2026-11-25', kg: 80.5 })
  repo.addMeal({ date: '2026-11-25', slot: 'lunch', description: 'salmon bowl', portion: 'normal', kcal: 650 })
  store.close()

  const reopened = await Store.open(file, wasm)
  const repo2 = new Repo(reopened)
  assert.equal(repo2.listActivities('2026-11-01', '2026-11-30').length, 1)
  assert.equal(repo2.listWeights('2026-11-01', '2026-11-30')[0].kg, 80.5)
  assert.equal(repo2.listMeals('2026-11-25')[0].kcal, 650)
  reopened.close()
})

test('synced activities are updated in place instead of duplicated', async () => {
  const { store, repo } = await fresh()
  const row = {
    kind: 'row' as const,
    source: 'concept2' as const,
    externalId: '42',
    date: '2026-11-25',
    startedAt: null,
    title: 'Just Row',
    durationSec: 1200,
    distanceM: 5000,
    detail: { paceSecPer500: 120 }
  }
  assert.equal(repo.upsertSynced(row), true)
  assert.equal(repo.upsertSynced({ ...row, distanceM: 5100 }), false)
  const list = repo.listActivities('2026-11-25', '2026-11-25')
  assert.equal(list.length, 1)
  assert.equal(list[0].distanceM, 5100)
  assert.deepEqual(list[0].detail, { paceSecPer500: 120 })
  assert.equal(repo.latestActivityDate('concept2'), '2026-11-25')
  assert.equal(repo.latestActivityDate('hevy'), null)
  store.close()
})

test('invalid input from the window is rejected', async () => {
  const { store, repo } = await fresh()
  assert.throws(() => repo.addActivity({ kind: 'swim' as never, date: '2026-11-25' }))
  assert.throws(() => repo.addActivity({ kind: 'walk', date: '25/11/2026' }))
  assert.throws(() => repo.addWeight({ date: '2026-11-25', kg: 5 }))
  assert.throws(() =>
    repo.addMeal({ date: '2026-11-25', slot: 'lunch', description: '   ', portion: 'normal' })
  )
  store.close()
})

test('a database from a newer Arete is refused rather than damaged', async () => {
  const { file, store } = await fresh()
  store.close()
  const initSqlJs = (await import('sql.js')).default
  const SQL = await initSqlJs({ locateFile: () => wasm })
  const db = new SQL.Database(fs.readFileSync(file))
  db.exec('PRAGMA user_version = 99')
  fs.writeFileSync(file, Buffer.from(db.export()))
  await assert.rejects(Store.open(file, wasm), /newer version of Arete/)
})

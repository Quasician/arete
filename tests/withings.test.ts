import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { zipSync, strToU8 } from 'fflate'
import { ImportError, parseCsv, parseWeightCsv, readWithingsExport } from '../src/main/importers/withings.ts'
import { Store } from '../src/main/db.ts'
import { Repo } from '../src/main/repo.ts'

// Shaped like the weight.csv in a Withings export: newest first, quoted headers with units.
const KG_CSV = [
  'Date,"Weight (kg)","Fat mass (kg)","Bone mass (kg)","Muscle mass (kg)","Hydration (kg)",Comments',
  '"2026-11-26 07:02:11",81.65,16.33,3.2,61.1,44.0,',
  '"2026-11-25 07:10:45",81.9,,,,,"after travel, salty dinner"',
  '"2026-11-24 06:58:02",82.1,16.5,3.2,61.2,44.1,'
].join('\r\n')

const LB_CSV = ['Date,Weight (lb),Fat Ratio (%)', '2026-11-26 07:02:11,180.0,19.8', '2026-11-25 07:10:45,,'].join('\n')

test('parseCsv handles quotes, embedded commas and CRLF', () => {
  assert.deepEqual(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\r\n'), [
    ['a', 'b, c', 'say "hi"'],
    ['1', '2', '3']
  ])
})

test('reads kilograms and works out body fat % from fat mass', () => {
  const rows = parseWeightCsv(KG_CSV)
  assert.equal(rows.length, 3)
  assert.deepEqual(rows[0], { date: '2026-11-26', measuredAt: '2026-11-26T07:02:11', kg: 81.65, fatPct: 20 })
  assert.equal(rows[1].fatPct, null)
  assert.equal(rows[1].kg, 81.9)
})

test('converts pounds and reads a fat ratio column; skips rows with no weight', () => {
  const rows = parseWeightCsv(LB_CSV)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kg, 81.647)
  assert.equal(rows[0].fatPct, 19.8)
})

test('explains what went wrong with a file that is not a weight export', () => {
  assert.throws(() => parseWeightCsv('Date,Steps\n2026-11-25,12000'), (err: Error) => {
    assert.ok(err instanceof ImportError)
    assert.match(err.message, /Date, Steps/)
    return true
  })
  assert.throws(() => parseWeightCsv('Date,Weight\n2026-11-25,80'), /unit/)
})

test('finds the weight file inside the export ZIP', () => {
  const zip = zipSync({
    'activities.csv': strToU8('Date,Steps\n2026-11-25,12000'),
    'weight.csv': strToU8(KG_CSV),
    'notes.txt': strToU8('ignore me')
  })
  assert.equal(readWithingsExport('data_THO_123.zip', zip).length, 3)
  const noWeight = zipSync({ 'activities.csv': strToU8('Date,Steps\n2026-11-25,12000') })
  assert.throws(() => readWithingsExport('x.zip', noWeight), /No weight data found/)
})

test('importing the same export twice adds nothing the second time', async () => {
  const require = createRequire(import.meta.url)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arete-withings-'))
  const store = await Store.open(path.join(dir, 'arete.sqlite'), require.resolve('sql.js/dist/sql-wasm.wasm'))
  const repo = new Repo(store)
  const rows = parseWeightCsv(KG_CSV)
  assert.deepEqual(repo.importWithingsWeights(rows), { added: 3, updated: 0 })
  assert.deepEqual(repo.importWithingsWeights(rows), { added: 0, updated: 0 })
  const changed = rows.map((r, i) => (i === 0 ? { ...r, kg: 81.5 } : r))
  assert.deepEqual(repo.importWithingsWeights(changed), { added: 0, updated: 1 })
  const stored = repo.listWeights('2026-11-01', '2026-11-30')
  assert.equal(stored.length, 3)
  assert.ok(stored.every((w) => w.source === 'withings'))
  store.close()
})

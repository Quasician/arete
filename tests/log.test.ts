import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initLog, log, logTail, logged, scrub } from '../src/main/log.ts'

test('the log records lines with times and hides anything key-like', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arete-log-'))
  initLog(dir)
  log('sync', 'hevy', 'ok', '2 new workouts')
  log('request', { headers: { 'api-key': 'abc123secret' } })
  log('auth', 'Authorization: Bearer xyz789')
  await assert.rejects(logged('progression', async () => { throw new Error('Hevy returned an error (400): bad set') }))
  const lines = logTail()
  assert.equal(lines.length, 4)
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T.* sync hevy ok 2 new workouts$/)
  assert.ok(!lines.join('\n').includes('abc123secret'))
  assert.ok(!lines.join('\n').includes('xyz789'))
  assert.match(lines[3], /progression FAILED \d+ms Error: Hevy returned an error \(400\): bad set/)
  assert.equal(scrub('key sk-ant-api03-AAAA_bb'), 'key [hidden]')
})

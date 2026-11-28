import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays } from '../src/shared/logic.ts'
import { balanceAt, loggedDays } from '../src/shared/energy.ts'
import { parseEstimate } from '../src/main/estimate.ts'
import type { Meal } from '../src/shared/types.ts'

let id = 1
function meal(date: string, kcal: number | null): Meal {
  return { id: id++, date, slot: 'lunch', description: 'x', portion: 'normal', kcal, proteinG: null, source: 'manual', kcalLow: null, kcalHigh: null, note: null }
}

test('loggedDays only counts days with at least two meals with calories', () => {
  const days = loggedDays([meal('2026-11-01', 600), meal('2026-11-01', 900), meal('2026-11-02', 700), meal('2026-11-02', null)])
  assert.deepEqual(days, [{ date: '2026-11-01', kcal: 1500, meals: 2 }])
})

test('balanceAt works out burn from intake and the weight trend', () => {
  const end = '2026-11-21'
  const start = addDays(end, -20)
  const days = Array.from({ length: 21 }, (_, i) => ({ date: addDays(start, i), kcal: 2000, meals: 3 }))
  // Lost 1 kg over the 21 days: 7,700 kcal deficit = 367 kcal/day, so burn = 2,367.
  const trend = [
    { date: start, value: 82 },
    { date: end, value: 81 }
  ]
  const b = balanceAt(end, days, trend)!
  assert.equal(b.intake, 2000)
  assert.equal(b.loggedDays, 21)
  assert.equal(b.burn, 2367)
})

test('balanceAt waits for enough logged days and weight at both ends', () => {
  const days = Array.from({ length: 5 }, (_, i) => ({ date: addDays('2026-11-15', i), kcal: 2000, meals: 3 }))
  assert.equal(balanceAt('2026-11-21', days, [{ date: '2026-11-01', value: 82 }, { date: '2026-11-21', value: 81 }]), null)
})

test('parseEstimate reads the JSON reply and keeps the range around the estimate', () => {
  const e = parseEstimate('Here you go: {"kcal": 820, "kcal_low": 650, "kcal_high": 1000, "protein_g": 42.4, "note": "assumes 6 oz chicken, 1 cup rice"}')
  assert.deepEqual(e, { kcal: 820, kcalLow: 650, kcalHigh: 1000, proteinG: 42, note: 'assumes 6 oz chicken, 1 cup rice' })
  assert.throws(() => parseEstimate('no idea'), /unexpected form/)
  assert.throws(() => parseEstimate('{"kcal": -5}'), /sensible/)
})

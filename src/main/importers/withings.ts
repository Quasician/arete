// Reads weigh-ins from a Withings data export: the ZIP archive Withings emails
// you, or the weight CSV inside it. No network or database code here, so it
// can be tested on sample files.
import { unzipSync, strFromU8 } from 'fflate'

const KG_PER_LB = 0.45359237

export interface WithingsWeight {
  /** Local calendar date, YYYY-MM-DD. */
  date: string
  /** Local time as written in the export, used to recognise repeat imports. */
  measuredAt: string
  kg: number
  fatPct: number | null
}

export class ImportError extends Error {}

/** Parse CSV text, handling quoted fields, embedded commas and CRLF line endings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  row.push(field)
  if (row.some((f) => f.trim() !== '')) rows.push(row)
  return rows
}

type Unit = 'kg' | 'lb'

function unitOf(header: string): Unit | null {
  const m = header.match(/\((kg|lb|lbs)\)/i)
  if (!m) return null
  return m[1].toLowerCase() === 'kg' ? 'kg' : 'lb'
}

function toKg(value: number, unit: Unit): number {
  return unit === 'kg' ? value : value * KG_PER_LB
}

/** Numbers may use a decimal comma when the Withings account is set to a European locale. */
function parseNumber(raw: string | undefined): number | null {
  if (raw == null) return null
  const s = raw.trim().replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return isFinite(n) ? n : null
}

/** "2026-11-25 07:12:33", "2026-11-25T07:12:33" or "2026-11-25" → date and time. */
function parseDateTime(raw: string): { date: string; measuredAt: string } | null {
  const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/)
  if (!m) return null
  return { date: m[1], measuredAt: m[2] ? `${m[1]}T${m[2].length === 5 ? m[2] + ':00' : m[2]}` : `${m[1]}T00:00:00` }
}

/** Read weigh-ins from the weight CSV's text. */
export function parseWeightCsv(text: string): WithingsWeight[] {
  const rows = parseCsv(text)
  if (rows.length === 0) throw new ImportError('The file is empty.')
  const header = rows[0].map((h) => h.trim())
  const dateCol = header.findIndex((h) => /^date/i.test(h))
  const weightCol = header.findIndex((h) => /^weight\b/i.test(h))
  if (dateCol < 0 || weightCol < 0) {
    throw new ImportError(
      `This doesn't look like a Withings weight file. Its columns are: ${header.join(', ') || '(none)'}.`
    )
  }
  const weightUnit = unitOf(header[weightCol])
  if (!weightUnit) {
    throw new ImportError(
      `Couldn't tell the weight unit from the column "${header[weightCol]}". Expected kg or lb.`
    )
  }
  const fatPctCol = header.findIndex((h) => /^fat\s*(ratio|%|percent)/i.test(h) || /^fat.*\(%\)/i.test(h))
  const fatMassCol = header.findIndex((h) => /^fat\s*mass/i.test(h))
  const fatMassUnit = fatMassCol >= 0 ? unitOf(header[fatMassCol]) : null

  const out: WithingsWeight[] = []
  for (const row of rows.slice(1)) {
    const when = parseDateTime(row[dateCol] ?? '')
    const weight = parseNumber(row[weightCol])
    if (!when || weight == null || weight <= 0) continue
    const kg = toKg(weight, weightUnit)
    if (kg < 20 || kg > 400) continue
    let fatPct: number | null = null
    const ratio = fatPctCol >= 0 ? parseNumber(row[fatPctCol]) : null
    if (ratio != null && ratio > 0 && ratio < 75) fatPct = ratio
    else if (fatMassCol >= 0 && fatMassUnit) {
      const mass = parseNumber(row[fatMassCol])
      if (mass != null && mass > 0) {
        const pct = (toKg(mass, fatMassUnit) / kg) * 100
        if (pct > 1 && pct < 75) fatPct = Math.round(pct * 10) / 10
      }
    }
    out.push({ date: when.date, measuredAt: when.measuredAt, kg: Math.round(kg * 1000) / 1000, fatPct })
  }
  return out
}

/** Read weigh-ins from a file the user picked: the export ZIP or a weight CSV. */
export function readWithingsExport(fileName: string, bytes: Uint8Array): WithingsWeight[] {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b // "PK"
  if (!isZip) return parseWeightCsv(new TextDecoder().decode(bytes))

  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, { filter: (f) => /\.csv$/i.test(f.name) })
  } catch {
    throw new ImportError(`Couldn't open ${fileName} as a ZIP archive.`)
  }
  const names = Object.keys(files)
  // Prefer a file named weight.csv; otherwise any CSV whose header has a weight column.
  const ordered = [
    ...names.filter((n) => /(^|\/)weight\.csv$/i.test(n)),
    ...names.filter((n) => !/(^|\/)weight\.csv$/i.test(n))
  ]
  for (const name of ordered) {
    const text = strFromU8(files[name])
    const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0]
    if (!/(^|,)"?date/i.test(firstLine) || !/(^|,)"?weight\b/i.test(firstLine)) continue
    return parseWeightCsv(text)
  }
  throw new ImportError(
    `No weight data found in ${fileName}. It contains: ${names.slice(0, 12).join(', ') || 'no CSV files'}.`
  )
}

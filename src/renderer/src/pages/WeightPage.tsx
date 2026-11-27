import { useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MIN_GAP_DAYS, addDays, morningTrend, readingHour, toLocalDate } from '@shared/logic'
import type { ImportResult, Units, WeightEntry } from '@shared/types'
import { api, errorText, keys, useInvalidate, useSettings } from '../api'
import { formatWeight, longDate, weightFromKg, weightToKg } from '../format'
import { TREND_DAYS, WeightChart } from '../components/TrendCharts'
import { useWide } from '../useWide'

const RANGES = [
  { label: '3 months', days: 91 },
  { label: '1 year', days: 365 },
  { label: 'All', days: null }
] as const

export function WeightPage() {
  const today = toLocalDate(new Date())
  const [rangeIndex, setRangeIndex] = useState(0)
  const range = RANGES[rangeIndex]
  const from = range.days ? addDays(today, -(range.days - 1)) : '1900-01-01'
  const units = useSettings().data?.units ?? 'lb'
  const list = useQuery({ queryKey: keys.weights(from, today), queryFn: () => api.listWeights(from, today) })
  const entries = list.data ?? []

  // Trend from the whole history, so the morning/evening gap and the
  // average at the start of the shown range use all the data.
  const all = useQuery({ queryKey: keys.weights('1900-01-01', today), queryFn: () => api.listWeights('1900-01-01', today) })
  const fullTrend = useMemo(() => morningTrend(all.data ?? [], TREND_DAYS), [all.data])
  const trend = fullTrend.trend.filter((p) => p.date >= from)
  const daily = fullTrend.daily.filter((p) => p.date >= from)
  const latest = fullTrend.trend.at(-1)
  const weekAgo = fullTrend.trend.findLast((p) => p.date <= addDays(today, -7))
  const change = latest && weekAgo ? latest.value - weekAgo.value : null
  const wide = useWide()

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Weight</h1>
          <p className="subtle">
            The line is a {TREND_DAYS}-day average of morning weigh-ins, the most consistent reading of the day. Days
            with only an evening reading use it minus your usual evening gain.
          </p>
        </div>
        <div className="segmented">
          {RANGES.map((r, i) => (
            <button key={r.label} className={i === rangeIndex ? 'active' : ''} onClick={() => setRangeIndex(i)}>
              {r.label}
            </button>
          ))}
        </div>
      </header>

      <div className="weight-layout">
        <div className="col">
          <div className="stats">
            <Stat label="Trend weight" value={latest ? formatWeight(latest.value, units) : '–'} />
            <Stat
              label="Change over 7 days"
              value={change == null ? '–' : `${change > 0 ? '+' : ''}${weightFromKg(change, units).toFixed(1)} ${units}`}
            />
            <Stat
              label="Usual evening gain"
              value={
                fullTrend.gapKg == null
                  ? '–'
                  : `${fullTrend.gapKg >= 0 ? '+' : ''}${weightFromKg(fullTrend.gapKg, units).toFixed(1)} ${units}`
              }
              hint={
                fullTrend.gapKg == null
                  ? `Learned after ${MIN_GAP_DAYS} days with both a morning and an evening weigh-in`
                  : `Median over ${fullTrend.pairedDays} days with both readings`
              }
            />
          </div>
          {entries.length > 0 && (
            <section className="card">
              <WeightChart entries={entries} daily={daily} trend={trend} units={units} height={wide ? 620 : 300} />
            </section>
          )}
        </div>

        <div className="col">
          <WithingsImportCard />

          <details className="card">
            <summary>Add a weigh-in by hand</summary>
            <AddWeightForm units={units} today={today} />
          </details>

          <section className="card">
            <h2>Recent weigh-ins</h2>
            {list.error && <p className="error">{errorText(list.error)}</p>}
            {entries.length === 0 && !list.isLoading && <p className="subtle">No weigh-ins yet.</p>}
            <WeightList entries={[...entries].reverse().slice(0, wide ? 20 : 30)} units={units} />
          </section>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  )
}

function formatClock(measuredAt: string): string {
  const hour = readingHour(measuredAt)
  const m = measuredAt.match(/T\d{2}:(\d{2})/)
  const minutes = /(Z|[+-]\d{2}:\d{2})$/.test(measuredAt)
    ? String(new Date(measuredAt).getMinutes()).padStart(2, '0')
    : (m?.[1] ?? '00')
  return `${hour % 12 || 12}:${minutes} ${hour < 12 ? 'AM' : 'PM'}`
}

function WithingsImportCard() {
  const invalidate = useInvalidate()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runImport() {
    setBusy(true)
    setError(null)
    try {
      const r = await api.importWithings()
      if (r) {
        setResult(r)
        invalidate('weights')
      }
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>Import from Withings</h2>
      <p className="subtle small">
        In the Withings app, go to Profile → Settings → Export All Health Data → Start my archive. Withings emails you
        a ZIP file; import it here as is. Importing the same weigh-ins again never creates duplicates.
      </p>
      <button className="button" onClick={runImport} disabled={busy}>
        {busy ? 'Importing…' : 'Import Withings export…'}
      </button>
      {result && (
        <p className="subtle small">
          {result.added === 0 && result.updated === 0
            ? `Already up to date: all ${result.total} weigh-ins from ${result.fileName} were imported before.`
            : `Added ${result.added} new weigh-in${result.added === 1 ? '' : 's'}` +
              (result.updated ? ` and updated ${result.updated}` : '') +
              ` from ${result.fileName}` +
              (result.from && result.to ? ` (${longDate(result.from)} – ${longDate(result.to)}).` : '.')}
        </p>
      )}
      {error && <p className="error small">{error}</p>}
    </section>
  )
}

function AddWeightForm({ units, today }: { units: Units; today: string }) {
  const invalidate = useInvalidate()
  const [date, setDate] = useState(today)
  const [value, setValue] = useState('')
  const [fat, setFat] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await api.addWeight({
        date,
        kg: weightToKg(Number(value), units),
        fatPct: fat ? Number(fat) : null
      })
      setValue('')
      setFat('')
      invalidate('weights')
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <form className="form-row" onSubmit={submit}>
      <label>
        Date
        <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <label>
        Weight ({units})
        <input type="number" step="0.1" min="40" value={value} onChange={(e) => setValue(e.target.value)} required />
      </label>
      <label>
        Body fat % (optional)
        <input type="number" step="0.1" min="1" max="75" value={fat} onChange={(e) => setFat(e.target.value)} />
      </label>
      <button className="button" type="submit">
        Add
      </button>
      {error && <p className="error small full">{error}</p>}
    </form>
  )
}

function WeightList({ entries, units }: { entries: WeightEntry[]; units: Units }) {
  const invalidate = useInvalidate()
  return (
    <table className="table">
      <tbody>
        {entries.map((e) => (
          <tr key={e.id}>
            <td>{longDate(e.date)}</td>
            <td className="subtle">{formatClock(e.measuredAt)}</td>
            <td>{formatWeight(e.kg, units)}</td>
            <td>{e.fatPct != null ? `${e.fatPct}% fat` : ''}</td>
            <td className="subtle small">{e.source === 'withings' ? 'Withings' : 'Logged'}</td>
            <td className="right">
              {e.source === 'manual' && (
                <button
                  className="link danger"
                  onClick={async () => {
                    await api.deleteWeight(e.id)
                    invalidate('weights')
                  }}
                >
                  Remove
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

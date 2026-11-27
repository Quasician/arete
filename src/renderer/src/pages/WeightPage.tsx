import { useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays, dailyMeans, rollingAverage, toLocalDate } from '@shared/logic'
import type { Units, WeightEntry } from '@shared/types'
import { api, errorText, keys, useInvalidate, useSettings } from '../api'
import { formatWeight, longDate, weightFromKg, weightToKg } from '../format'
import { TREND_DAYS, WeightChart } from '../components/TrendCharts'
import { useWide } from '../useWide'

const RANGE_DAYS = 120

export function WeightPage() {
  const today = toLocalDate(new Date())
  const from = addDays(today, -(RANGE_DAYS - 1))
  const units = useSettings().data?.units ?? 'lb'
  const list = useQuery({ queryKey: keys.weights(from, today), queryFn: () => api.listWeights(from, today) })
  const entries = list.data ?? []

  const trend = useMemo(
    () => rollingAverage(dailyMeans(entries.map((e) => ({ date: e.date, value: e.kg }))), TREND_DAYS),
    [entries]
  )
  const latest = trend.at(-1)
  const weekAgo = trend.findLast((p) => p.date <= addDays(today, -7))
  const change = latest && weekAgo ? latest.value - weekAgo.value : null
  const wide = useWide()

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Weight</h1>
          <p className="subtle">
            The line is a {TREND_DAYS}-day average, so daily swings from water and salt don't hide the real trend.
          </p>
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
            <Stat label="Weigh-ins" value={String(entries.length)} />
          </div>
          {entries.length > 0 && (
            <section className="card">
              <WeightChart entries={entries} trend={trend} units={units} height={wide ? 620 : 300} />
            </section>
          )}
        </div>

        <div className="col">
          <section className="card">
            <h2>Add a weigh-in</h2>
            <p className="subtle small">Withings readings will import automatically in a later version.</p>
            <AddWeightForm units={units} today={today} />
          </section>

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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
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
            <td>{formatWeight(e.kg, units)}</td>
            <td>{e.fatPct != null ? `${e.fatPct}% fat` : ''}</td>
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

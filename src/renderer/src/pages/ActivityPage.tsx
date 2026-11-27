import { useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays, toLocalDate } from '@shared/logic'
import { ACTIVITY_KINDS, KIND_LABELS, type Activity, type ActivityKind } from '@shared/types'
import { api, errorText, keys, useInvalidate } from '../api'
import { longDate } from '../format'
import { ActivityLine } from '../components/ActivityLine'
import { PaceChart } from '../components/TrendCharts'
import { useWide } from '../useWide'

const RANGE_DAYS = 90

export function ActivityPage() {
  const today = toLocalDate(new Date())
  const from = addDays(today, -(RANGE_DAYS - 1))
  const list = useQuery({ queryKey: keys.activities(from, today), queryFn: () => api.listActivities(from, today) })
  const [filter, setFilter] = useState<ActivityKind | 'all'>('all')

  const activities = list.data ?? []
  const shown = filter === 'all' ? activities : activities.filter((a) => a.kind === filter)
  const byDate = useMemo(() => groupByDate(shown), [shown])
  const rows = activities.filter((a) => a.kind === 'row' && a.detail.paceSecPer500)
  const wide = useWide()

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Activity</h1>
          <p className="subtle">Last {RANGE_DAYS} days</p>
        </div>
      </header>

      <div className="two-col">
        <div className="col">
          <section className="card">
            <h2>Log an activity</h2>
            <AddActivityForm defaultDate={today} />
          </section>

          {rows.length > 1 && (
            <section className="card">
              <h2>Rowing pace</h2>
              <p className="subtle small">Average split per session. Lower is faster.</p>
              <PaceChart rows={rows} height={wide ? 460 : 240} />
            </section>
          )}
        </div>

      <section className="card col">
        <div className="card-header">
          <h2>History</h2>
          <select value={filter} onChange={(e) => setFilter(e.target.value as ActivityKind | 'all')}>
            <option value="all">All types</option>
            {ACTIVITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        {list.error && <p className="error">{errorText(list.error)}</p>}
        {byDate.length === 0 && !list.isLoading && <p className="subtle">Nothing logged in this period yet.</p>}
        {byDate.map(([date, items]) => (
          <div key={date} className="history-day">
            <h3>{longDate(date)}</h3>
            {items.map((a) => (
              <ActivityLine key={a.id} activity={a} />
            ))}
          </div>
        ))}
      </section>
      </div>
    </div>
  )
}

function groupByDate(items: Activity[]): [string, Activity[]][] {
  const map = new Map<string, Activity[]>()
  for (const a of items) map.set(a.date, [...(map.get(a.date) ?? []), a])
  return [...map.entries()]
}

function AddActivityForm({ defaultDate }: { defaultDate: string }) {
  const invalidate = useInvalidate()
  const [kind, setKind] = useState<ActivityKind>('climb')
  const [date, setDate] = useState(defaultDate)
  const [minutes, setMinutes] = useState('')
  const [distance, setDistance] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await api.addActivity({
        kind,
        date,
        title: title || null,
        durationSec: minutes ? Math.round(Number(minutes) * 60) : null,
        distanceM: distance ? Math.round(Number(distance) * 1000) : null
      })
      setMinutes('')
      setDistance('')
      setTitle('')
      invalidate('week', 'activities')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="form-row" onSubmit={submit}>
      <label>
        Type
        <select value={kind} onChange={(e) => setKind(e.target.value as ActivityKind)}>
          {ACTIVITY_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Date
        <input type="date" value={date} max={defaultDate} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <label>
        Minutes
        <input type="number" min="0" step="1" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      </label>
      <label>
        Distance (km)
        <input type="number" min="0" step="0.1" value={distance} onChange={(e) => setDistance(e.target.value)} />
      </label>
      <label className="grow">
        Note
        <input value={title} maxLength={80} placeholder="e.g. Mission Peak" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <button className="button" type="submit" disabled={saving}>
        Add
      </button>
      {error && <p className="error small full">{error}</p>}
    </form>
  )
}

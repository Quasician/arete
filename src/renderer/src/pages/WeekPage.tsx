import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays, dailyMeans, formatDuration, rollingAverage, toLocalDate, weekStartOf } from '@shared/logic'
import { ACTIVITY_KINDS, KIND_LABELS, type ActivityKind, type DayView } from '@shared/types'
import { api, errorText, keys, useInvalidate, useSettings } from '../api'
import { useUi } from '../store'
import { formatDistance, formatWeight, monthDay, weekday, weightFromKg } from '../format'
import { ActivityLine } from '../components/ActivityLine'
import { PaceChart, TREND_DAYS, WeightChart } from '../components/TrendCharts'

export function WeekPage() {
  const today = toLocalDate(new Date())
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today))
  const week = useQuery({ queryKey: keys.week(weekStart), queryFn: () => api.getWeek(weekStart) })
  const setPage = useUi((s) => s.setPage)
  const data = week.data
  const noPlan = data && data.plannedCount === 0

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>
            {monthDay(weekStart)} – {monthDay(addDays(weekStart, 6))}
          </h1>
          {data && data.plannedCount > 0 && (
            <p className="subtle">
              {data.plannedDoneCount} of {data.plannedCount} planned sessions done
            </p>
          )}
        </div>
        <div className="row">
          <button className="button ghost" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            ← Previous
          </button>
          <button className="button ghost" onClick={() => setWeekStart(weekStartOf(today))}>
            This week
          </button>
          <button className="button ghost" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            Next →
          </button>
        </div>
      </header>

      {data?.program && (
        <div className="banner">
          <strong>{data.program.name}</strong> · week {data.program.week} of {data.program.total}
          <div className="progress">
            <div style={{ width: `${(data.program.week / data.program.total) * 100}%` }} />
          </div>
        </div>
      )}

      {noPlan && (
        <div className="banner muted">
          No weekly plan yet. Set which sessions you plan on each day in{' '}
          <button className="link" onClick={() => setPage('settings')}>
            Settings
          </button>{' '}
          to see planned versus done here.
        </div>
      )}

      {week.error && <p className="error">{errorText(week.error)}</p>}

      <div className="week-layout">
        <div className="week-grid">
          {data?.days.map((day) => <DayColumn key={day.date} day={day} isToday={day.date === today} />)}
        </div>
        {data && <WeekRail weekStart={weekStart} days={data.days} />}
      </div>
    </div>
  )
}

/** Totals for the shown week plus the weight and rowing trends, beside the week on wide screens. */
function WeekRail({ weekStart, days }: { weekStart: string; days: DayView[] }) {
  const units = useSettings().data?.units ?? 'lb'
  const today = toLocalDate(new Date())
  const weightFrom = addDays(today, -44)
  const weights = useQuery({
    queryKey: keys.weights(weightFrom, today),
    queryFn: () => api.listWeights(weightFrom, today)
  }).data
  const rowFrom = addDays(today, -55)
  const recent = useQuery({
    queryKey: keys.activities(rowFrom, today),
    queryFn: () => api.listActivities(rowFrom, today)
  }).data

  const activities = days.flatMap((d) => d.activities)
  const trainingSec = activities.reduce((s, a) => s + (a.durationSec ?? 0), 0)
  const rowedM = activities.filter((a) => a.kind === 'row').reduce((s, a) => s + (a.distanceM ?? 0), 0)
  const activeDays = days.filter((d) => d.activities.length > 0).length

  const trend = useMemo(
    () => rollingAverage(dailyMeans((weights ?? []).map((e) => ({ date: e.date, value: e.kg }))), TREND_DAYS),
    [weights]
  )
  const shownTrend = trend.filter((p) => p.date >= addDays(today, -29))
  const latest = trend.at(-1)
  const weekAgo = trend.findLast((p) => p.date <= addDays(today, -7))
  const change = latest && weekAgo ? weightFromKg(latest.value - weekAgo.value, units) : null
  const rows = (recent ?? []).filter((a) => a.kind === 'row' && a.detail.paceSecPer500)

  return (
    <aside className="week-rail">
      <section className="card">
        <h2>{weekStart === weekStartOf(today) ? 'This week' : 'That week'}</h2>
        <div className="mini-stats">
          <MiniStat value={String(activities.length)} label="sessions" />
          <MiniStat value={`${activeDays}/7`} label="active days" />
          <MiniStat value={trainingSec ? formatDuration(trainingSec) : '–'} label="training time" />
          <MiniStat value={rowedM ? formatDistance(rowedM) : '–'} label="rowed" />
        </div>
      </section>

      <section className="card">
        <h2>Weight trend</h2>
        <div className="mini-stats">
          <MiniStat value={latest ? formatWeight(latest.value, units) : '–'} label="trend weight" />
          <MiniStat
            value={change == null ? '–' : `${change > 0 ? '+' : ''}${change.toFixed(1)} ${units}`}
            label="last 7 days"
          />
        </div>
        {shownTrend.length > 1 && (
          <WeightChart
            entries={(weights ?? []).filter((w) => w.date >= addDays(today, -29))}
            trend={shownTrend}
            units={units}
            height={200}
            compact
          />
        )}
      </section>

      {rows.length > 1 && (
        <section className="card">
          <h2>Rowing pace, last 8 weeks</h2>
          <PaceChart rows={rows} height={200} />
        </section>
      )}
    </aside>
  )
}

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="mini-stat">
      <div className="mini-stat-value">{value}</div>
      <div className="mini-stat-label">{label}</div>
    </div>
  )
}

function DayColumn({ day, isToday }: { day: DayView; isToday: boolean }) {
  const invalidate = useInvalidate()
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isFuture = day.date > toLocalDate(new Date())

  async function checkIn(kind: ActivityKind) {
    setError(null)
    try {
      await api.addActivity({ kind, date: day.date })
      invalidate('week', 'activities')
    } catch (err) {
      setError(errorText(err))
    }
    setPicking(false)
  }

  const plannedOpen = day.planned.filter((k) => !day.plannedDone.includes(k))

  return (
    <section className={isToday ? 'day today' : 'day'}>
      <header>
        <span className="day-name">{weekday(day.date)}</span>
        <span className="day-date">{monthDay(day.date)}</span>
      </header>

      <div className="chips">
        {day.plannedDone.map((k, i) => (
          <span key={`done-${k}-${i}`} className="chip done">
            ✓ {KIND_LABELS[k]}
          </span>
        ))}
        {plannedOpen.map((k, i) =>
          isFuture ? (
            <span key={`open-${k}-${i}`} className="chip planned">
              {KIND_LABELS[k]}
            </span>
          ) : (
            <button
              key={`open-${k}-${i}`}
              className="chip planned clickable"
              title={`Mark ${KIND_LABELS[k].toLowerCase()} as done`}
              onClick={() => checkIn(k)}
            >
              {KIND_LABELS[k]}
            </button>
          )
        )}
      </div>

      <div className="day-activities">
        {day.activities.map((a) => (
          <ActivityLine key={a.id} activity={a} compact />
        ))}
      </div>

      {!isFuture &&
        (picking ? (
          <div className="chips">
            {ACTIVITY_KINDS.map((k) => (
              <button key={k} className="chip clickable" onClick={() => checkIn(k)}>
                {KIND_LABELS[k]}
              </button>
            ))}
            <button className="chip clickable ghost" onClick={() => setPicking(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="add-button" onClick={() => setPicking(true)}>
            + Log
          </button>
        ))}
      {error && <p className="error small">{error}</p>}
    </section>
  )
}

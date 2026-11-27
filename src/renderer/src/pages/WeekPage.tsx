import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays, toLocalDate, weekStartOf } from '@shared/logic'
import { ACTIVITY_KINDS, KIND_LABELS, type ActivityKind, type DayView } from '@shared/types'
import { api, errorText, keys, useInvalidate } from '../api'
import { useUi } from '../store'
import { monthDay, weekday } from '../format'
import { ActivityLine } from '../components/ActivityLine'

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

      <div className="week-grid">
        {data?.days.map((day) => <DayColumn key={day.date} day={day} isToday={day.date === today} />)}
      </div>
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

import { useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays, morningTrend, toLocalDate, weekStartOf } from '@shared/logic'
import {
  MILESTONES,
  habitStatus,
  recoverySuggestion,
  starterHabits,
  type Habit,
  type HabitStatus
} from '@shared/habits'
import { weeklyReview, type WeeklyReview } from '@shared/review'
import { findWins } from '@shared/wins'
import { ACTIVITY_KINDS, KIND_LABELS, type ActivityKind, type PublicSettings } from '@shared/types'
import { api, errorText, keys, useInvalidate, useSettings, useUpdateSettings } from '../api'
import { useUi } from '../store'
import { formatWeight, longDate, monthDay, weekday } from '../format'
import { TREND_DAYS } from '../components/TrendCharts'

const ALL = '1900-01-01'
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function HabitsPage() {
  const today = toLocalDate(new Date())
  const settings = useSettings().data
  const activities = useQuery({ queryKey: keys.activities(ALL, today), queryFn: () => api.listActivities(ALL, today) })
  const weights = useQuery({ queryKey: keys.weights(ALL, today), queryFn: () => api.listWeights(ALL, today) })
  const [editing, setEditing] = useState<Habit | 'new' | null>(null)

  const statuses = useMemo(
    () => (settings?.habits ?? []).filter((h) => h.active).map((h) => habitStatus(h, activities.data ?? [], today)),
    [settings?.habits, activities.data, today]
  )

  if (!settings) return <div className="page" />
  const recovery = !!settings.recoveryUntil && today <= settings.recoveryUntil
  const habits = settings.habits

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Habits</h1>
          <p className="subtle">
            Each habit is an if-then plan with a full and a minimum version. Doing the minimum still counts.
          </p>
        </div>
        <div className="row">
          <button className="button ghost" onClick={() => setEditing('new')}>
            + New habit
          </button>
        </div>
      </header>

      {activities.error && <p className="error">{errorText(activities.error)}</p>}

      {habits.length === 0 ? (
        <StarterCard settings={settings} today={today} />
      ) : (
        <>
          <RecoveryBanner statuses={statuses} settings={settings} today={today} recovery={recovery} />
          <div className="habit-today">
            {statuses.map((s) => (
              <TodayCard key={s.habit.id} status={s} recovery={recovery} />
            ))}
          </div>
          <div className="two-col">
            <div className="col">
              <section className="card">
                <h2>Habit strength</h2>
                <p className="subtle small">
                  Grows with every repetition and dips, rather than resets, after a miss. On average habits took about 66
                  days to become automatic in research (Lally et al., 2010), so the bar fills over roughly that many
                  repetitions.
                </p>
                {statuses.map((s) => (
                  <StrengthRow key={s.habit.id} status={s} today={today} onEdit={() => setEditing(s.habit)} />
                ))}
                {habits.some((h) => !h.active) && (
                  <p className="subtle small">
                    Paused:{' '}
                    {habits
                      .filter((h) => !h.active)
                      .map((h) => (
                        <button key={h.id} className="link" onClick={() => setEditing(h)}>
                          {h.name}
                        </button>
                      ))}
                  </p>
                )}
              </section>
              <TodoistCard settings={settings} />
            </div>
            <div className="col">
              <WinsCard settings={settings} statuses={statuses} today={today} weights={weights.data ?? []} activities={activities.data ?? []} />
              <ReviewCard habits={habits} activities={activities.data ?? []} today={today} />
            </div>
          </div>
        </>
      )}

      {editing && (
        <HabitEditor
          habit={editing === 'new' ? null : editing}
          settings={settings}
          today={today}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

// ---------- today ----------

function TodayCard({ status: s, recovery }: { status: HabitStatus; recovery: boolean }) {
  const invalidate = useInvalidate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const h = s.habit

  async function log(version: 'full' | 'minimum') {
    setBusy(true)
    setError(null)
    try {
      await api.logHabit(h.id, version)
      invalidate('activities', 'week')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const done = s.todayLevel !== 'none'
  return (
    <section className={`card today-card${done ? ' done' : ''}${s.dontMissTwice ? ' warn' : ''}`}>
      <div className="today-head">
        <span className={`kind kind-${h.kind}`}>{KIND_LABELS[h.kind]}</span>
        <h2>{h.name}</h2>
      </div>
      <p className="cue">
        <strong>If:</strong> {h.cue}
        {h.time && ` · ${formatTime(h.time)}`}
        <br />
        <strong>Then:</strong> {recovery ? `${h.minimumMinutes} min (recovery week)` : `${h.fullMinutes} min, or at least ${h.minimumMinutes}`}
      </p>
      {done ? (
        <p className="done-line">
          ✓ Done today{s.todayLevel === 'minimum' ? ' (minimum version)' : ''}
          {!s.todayScheduled && ' (an extra day)'}
        </p>
      ) : !s.todayScheduled ? (
        <p className="subtle small">
          Not planned today. Next: {s.nextScheduled ? `${weekday(s.nextScheduled)} ${monthDay(s.nextScheduled)}` : '—'}.
        </p>
      ) : (
        <>
          {s.dontMissTwice && <p className="warn-line">Missed last time. Don't miss twice: even the minimum keeps it alive.</p>}
          <div className="row">
            {!recovery && (
              <button className="button" disabled={busy} onClick={() => log('full')}>
                Did it ({h.fullMinutes} min)
              </button>
            )}
            <button className={recovery ? 'button' : 'button ghost'} disabled={busy} onClick={() => log('minimum')}>
              {recovery ? `Did it (${h.minimumMinutes} min)` : `Minimum (${h.minimumMinutes} min)`}
            </button>
          </div>
          <p className="subtle small">Synced workouts from Hevy or Concept2 tick this off on their own.</p>
        </>
      )}
      {error && <p className="error small">{error}</p>}
    </section>
  )
}

function formatTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

// ---------- strength ----------

function dotClass(d: HabitStatus['days'][number], today: string): string {
  if (!d.scheduled) return d.level !== 'none' ? 'extra' : 'off'
  if (d.level !== 'none') return d.level
  return d.date === today ? 'pending' : 'miss'
}

function StrengthRow({ status: s, onEdit, today }: { status: HabitStatus; onEdit: () => void; today: string }) {
  const next = MILESTONES.find((m) => m > s.repetitions)
  return (
    <div className="strength-row">
      <div className="strength-head">
        <strong>{s.habit.name}</strong>
        <span className="subtle small">
          {s.repetitions} repetition{s.repetitions === 1 ? '' : 's'}
          {next ? ` · next milestone ${next}` : ''}
          {s.scheduled28 > 0 && ` · kept ${s.kept28}/${s.scheduled28} in 4 weeks`}
        </span>
        <button className="link" onClick={onEdit}>
          Edit
        </button>
      </div>
      <div className="strength-bar" title={`${Math.round(s.strength * 100)}%`}>
        <div style={{ width: `${Math.max(1, s.strength * 100)}%` }} />
      </div>
      <div className="dots" aria-label="Last 28 days">
        {s.days.map((d) => (
          <span
            key={d.date}
            title={`${longDate(d.date)}: ${{ off: 'not planned', extra: 'done (not planned)', pending: 'today, not done yet', miss: 'missed', full: 'done', minimum: 'minimum version' }[dotClass(d, today)]}`}
            className={`dot ${dotClass(d, today)}`}
          />
        ))}
      </div>
    </div>
  )
}

// ---------- recovery ----------

function RecoveryBanner({
  statuses,
  settings,
  today,
  recovery
}: {
  statuses: HabitStatus[]
  settings: PublicSettings
  today: string
  recovery: boolean
}) {
  const update = useUpdateSettings()
  if (recovery) {
    return (
      <div className="banner">
        <strong>Recovery week</strong> until {longDate(settings.recoveryUntil!)}: only the minimum versions are asked for,
        and they count in full. The aim is to keep the cues firing, not to catch up.{' '}
        <button className="link" onClick={() => update.mutate({ recoveryUntil: null })}>
          End it early
        </button>
      </div>
    )
  }
  const reason = recoverySuggestion(statuses)
  if (!reason) return null
  return (
    <div className="banner">
      {reason} Rather than catching up, take a recovery week: minimum versions only for 7 days, then back to normal.{' '}
      <button className="button small" onClick={() => update.mutate({ recoveryUntil: addDays(today, 6) })}>
        Start a recovery week
      </button>
    </div>
  )
}

// ---------- wins ----------

function WinsCard({
  settings,
  statuses,
  today,
  weights,
  activities
}: {
  settings: PublicSettings
  statuses: HabitStatus[]
  today: string
  weights: Parameters<typeof morningTrend>[0]
  activities: Parameters<typeof findWins>[0]
}) {
  const wins = useMemo(() => {
    const trend = morningTrend(weights, TREND_DAYS).trend
    return findWins(activities, trend, statuses, (kg) => formatWeight(kg, settings.units), addDays(today, -30))
  }, [weights, activities, statuses, settings.units, today])
  return (
    <section className="card">
      <h2>Recent wins</h2>
      {wins.length === 0 ? (
        <p className="subtle">
          Personal records and habit milestones from the last 30 days show up here, with a notification when they
          happen.
        </p>
      ) : (
        <ul className="wins">
          {wins.slice(0, 10).map((w) => (
            <li key={w.id} className={`win win-${w.kind}`}>
              <div>
                <strong>{w.title}</strong>
                <div className="subtle small">{w.detail}</div>
              </div>
              <span className="subtle small">{monthDay(w.date)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------- weekly review ----------

function ReviewCard({ habits, activities, today }: { habits: Habit[]; activities: Parameters<typeof weeklyReview>[1]; today: string }) {
  const thisWeek = weekStartOf(today)
  const [weekStart, setWeekStart] = useState(addDays(thisWeek, -7))
  const upTo = weekStart === thisWeek ? addDays(today, -1) : addDays(weekStart, 6)
  const review: WeeklyReview = useMemo(
    () => weeklyReview(habits, activities, weekStart, upTo),
    [habits, activities, weekStart, upTo]
  )
  return (
    <section className="card">
      <div className="card-header">
        <h2>Weekly review</h2>
        <div className="segmented">
          <button className={weekStart !== thisWeek ? 'active' : ''} onClick={() => setWeekStart(addDays(thisWeek, -7))}>
            Last week
          </button>
          <button className={weekStart === thisWeek ? 'active' : ''} onClick={() => setWeekStart(thisWeek)}>
            This week so far
          </button>
        </div>
      </div>
      {review.keptRate == null ? (
        <p className="subtle">Nothing was planned in this week yet.</p>
      ) : (
        <>
          <p>
            Kept <strong>{Math.round(review.keptRate * 100)}%</strong> of planned habits ({monthDay(weekStart)} –{' '}
            {monthDay(addDays(weekStart, 6))}){review.slipped ? `; ${review.slipped} slipped the most.` : '.'}
          </p>
          <table className="table">
            <tbody>
              {review.habits.map((w) => (
                <tr key={w.habit.id}>
                  <td>{w.habit.name}</td>
                  <td>
                    {w.full + w.minimum}/{w.scheduled} kept
                  </td>
                  <td className="subtle">{w.minimum ? `${w.minimum} minimum` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {review.suggestions.length > 0 && (
            <>
              <h3>For next week</h3>
              <ul className="suggestions">
                {review.suggestions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <p className="subtle small">On Sundays this review also goes on your Todoist list, so it shows up in Praxis.</p>
    </section>
  )
}

// ---------- Todoist ----------

function TodoistCard({ settings }: { settings: PublicSettings }) {
  const update = useUpdateSettings()
  const setPage = useUi((s) => s.setPage)
  const status = settings.lastSync.todoist
  return (
    <section className="card">
      <h2>Habits in Todoist and Praxis</h2>
      {!settings.secrets.todoist ? (
        <p className="subtle">
          Add your Todoist token in{' '}
          <button className="link" onClick={() => setPage('settings')}>
            Settings
          </button>{' '}
          and each day's habits appear in Todoist, and so in Praxis, at their cue times. Ticking one there logs it here.
        </p>
      ) : (
        <>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.habitTasks}
              onChange={(e) => update.mutate({ habitTasks: e.target.checked })}
            />
            Put each day's habits in Todoist (project "Arete habits")
          </label>
          <p className="subtle small">
            Tasks appear at their cue time with their length, so Praxis can plan around them. Doing a habit closes its
            task; ticking the task logs the habit. Undone tasks from earlier days are removed instead of piling up.
          </p>
          {status && <p className={status.ok ? 'subtle small' : 'error small'}>{status.message}</p>}
        </>
      )}
    </section>
  )
}

// ---------- starter and editor ----------

function StarterCard({ settings, today }: { settings: PublicSettings; today: string }) {
  const update = useUpdateSettings()
  const starters = starterHabits(settings.plan, today, newId)
  return (
    <section className="card">
      <h2>Start with three habits</h2>
      <p className="subtle">
        A good start is two or three habits, each tied to a cue that already happens every day. These take their days
        from your weekly plan; edit the cues and times to match your mornings and evenings.
      </p>
      <ul className="suggestions">
        {starters.map((h) => (
          <li key={h.id}>
            <strong>{h.name}</strong>: if {h.cue.toLowerCase()} ({formatTime(h.time!)}), then {h.fullMinutes} minutes, or
            at least {h.minimumMinutes}. {h.days.map((d) => DAY_SHORT[d]).join(', ')}.
          </li>
        ))}
      </ul>
      <button className="button" onClick={() => update.mutate({ habits: starters })}>
        Add these three
      </button>
      {update.error && <p className="error small">{errorText(update.error)}</p>}
    </section>
  )
}

function HabitEditor({
  habit,
  settings,
  today,
  onClose
}: {
  habit: Habit | null
  settings: PublicSettings
  today: string
  onClose: () => void
}) {
  const update = useUpdateSettings()
  const [draft, setDraft] = useState<Habit>(
    habit ?? {
      id: newId(),
      name: '',
      kind: 'walk',
      days: [0, 1, 2, 3, 4, 5, 6],
      cue: '',
      time: null,
      fullMinutes: 30,
      minimumMinutes: 5,
      startDate: today,
      active: true
    }
  )
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Habit>(k: K, v: Habit[K]) => setDraft({ ...draft, [k]: v })

  function save(e: FormEvent) {
    e.preventDefault()
    if (!draft.name.trim() || !draft.cue.trim()) return setError('Give the habit a name and a cue.')
    if (draft.days.length === 0) return setError('Pick at least one day.')
    if (draft.minimumMinutes > draft.fullMinutes) return setError("The minimum can't be longer than the full version.")
    const habits = habit ? settings.habits.map((h) => (h.id === habit.id ? draft : h)) : [...settings.habits, draft]
    update.mutate({ habits }, { onSuccess: onClose, onError: (err) => setError(errorText(err)) })
  }

  function remove() {
    if (!habit) return
    if (!window.confirm(`Delete "${habit.name}"? Your logged activities stay; only the habit and its plan go. To keep its history visible, pause it instead.`)) return
    update.mutate({ habits: settings.habits.filter((h) => h.id !== habit.id) }, { onSuccess: onClose })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>{habit ? 'Edit habit' : 'New habit'}</h2>
        <div className="form-row">
          <label className="grow">
            Name
            <input value={draft.name} maxLength={60} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Morning row" />
          </label>
          <label>
            Counts when I log
            <select value={draft.kind} onChange={(e) => set('kind', e.target.value as ActivityKind)}>
              {ACTIVITY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label className="grow">
            If (the cue)
            <input
              value={draft.cue}
              maxLength={120}
              onChange={(e) => set('cue', e.target.value)}
              placeholder="e.g. After my alarm, before breakfast"
            />
          </label>
          <label>
            Around
            <input type="time" value={draft.time ?? ''} onChange={(e) => set('time', e.target.value || null)} />
          </label>
        </div>
        <div className="form-row">
          <label>
            Full version (min)
            <input
              type="number"
              min="1"
              max="600"
              value={draft.fullMinutes}
              onChange={(e) => set('fullMinutes', Math.max(1, Math.round(Number(e.target.value) || 1)))}
            />
          </label>
          <label>
            Minimum version (min)
            <input
              type="number"
              min="1"
              max="600"
              value={draft.minimumMinutes}
              onChange={(e) => set('minimumMinutes', Math.max(1, Math.round(Number(e.target.value) || 1)))}
            />
          </label>
          <label>
            Counting from
            <input type="date" value={draft.startDate} onChange={(e) => set('startDate', e.target.value)} required />
          </label>
        </div>
        <div className="day-picks">
          {DAY_SHORT.map((d, i) => (
            <label key={d} className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.days.includes(i)}
                onChange={(e) => set('days', e.target.checked ? [...draft.days, i].sort() : draft.days.filter((x) => x !== i))}
              />
              {d}
            </label>
          ))}
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={draft.active} onChange={(e) => set('active', e.target.checked)} />
          Active (untick to pause without losing its history)
        </label>
        {error && <p className="error small">{error}</p>}
        <div className="row">
          <button className="button" type="submit" disabled={update.isPending}>
            Save
          </button>
          <button className="button ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          {habit && (
            <button className="button ghost danger-button" type="button" onClick={remove}>
              Delete habit
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

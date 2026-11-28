import { useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays, morningTrend, toLocalDate, weekStartOf } from '@shared/logic'
import {
  MILESTONES,
  STAGE_LABELS,
  habitStatus,
  queueAdvice,
  recoverySuggestion,
  setActive,
  starterHabits,
  type Habit,
  type HabitStatus
} from '@shared/habits'
import { defaultMinimum } from '@shared/todoistHabits'
import { goalProgress } from '@shared/goals'
import { liftHistories } from '@shared/progress'
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
    () => (settings?.habits ?? []).filter((h) => !h.queued).map((h) => habitStatus(h, activities.data ?? [], today)),
    [settings?.habits, activities.data, today]
  )
  const [starting, setStarting] = useState<Habit | null>(null)

  if (!settings) return <div className="page" />
  const recovery = !!settings.recoveryUntil && today <= settings.recoveryUntil
  const habits = settings.habits
  const live = statuses.filter((s) => s.habit.active)
  const forming = live.filter((s) => s.stage !== 'formed')
  const formed = statuses.filter((s) => s.formedOn)
  const queued = habits.filter((h) => h.queued).sort((a, b) => (a.queueOrder ?? 0) - (b.queueOrder ?? 0))
  const fresh = formed.filter((s) => s.formedOn! >= addDays(today, -13))

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Habits</h1>
          <p className="subtle">
            Each habit is an if-then plan with a full and a minimum version. Doing the minimum still counts. Add one
            new habit at a time.
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
          {fresh.map((s) => (
            <Celebration key={s.habit.id} status={s} />
          ))}
          <RecoveryBanner statuses={live} settings={settings} today={today} recovery={recovery} />
          <div className="habit-today">
            {live
              .filter((s) => s.habit.startDate <= today)
              .map((s) => (
                <TodayCard key={s.habit.id} status={s} recovery={recovery} />
              ))}
          </div>
          <div className="two-col">
            <div className="col">
              <section className="card">
                <h2>Forming</h2>
                <p className="subtle small">
                  Strength grows with every repetition and dips, rather than resets, after a miss. Habits took about 66
                  days on average to become automatic in research (Lally et al., 2010). A habit counts as formed at 90%
                  strength while kept on at least 80% of its days for four weeks.
                </p>
                <StageKey />
                {forming.length === 0 && <p className="subtle">Nothing forming right now. Start one from Up next.</p>}
                {forming.map((s) => (
                  <StrengthRow key={s.habit.id} status={s} today={today} onEdit={() => setEditing(s.habit)} />
                ))}
                {statuses.some((s) => !s.habit.active) && (
                  <p className="subtle small">
                    Paused (history kept):{' '}
                    {statuses
                      .filter((s) => !s.habit.active)
                      .map((s, i) => (
                        <span key={s.habit.id}>
                          {i > 0 && ', '}
                          <button className="link" onClick={() => setEditing(s.habit)}>
                            {s.habit.name}
                          </button>{' '}
                          <span className="subtle">({Math.round(s.strength * 100)}%)</span>
                        </span>
                      ))}
                  </p>
                )}
              </section>
              <QueueCard
                queued={queued}
                statuses={live}
                today={today}
                settings={settings}
                onStart={setStarting}
                onEdit={setEditing}
              />
              <TodoistCard settings={settings} />
            </div>
            <div className="col">
              <FormedShelf formed={formed} today={today} />
              <WinsCard settings={settings} statuses={statuses} today={today} weights={weights.data ?? []} activities={activities.data ?? []} />
              <ReviewCard habits={habits} activities={activities.data ?? []} today={today} />
            </div>
          </div>
        </>
      )}

      {starting && <StartDialog habit={starting} today={today} onClose={() => setStarting(null)} />}
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

function StageChip({ status: s }: { status: HabitStatus }) {
  const label = s.needsAttention ? 'Formed · needs attention' : STAGE_LABELS[s.stage]
  return <span className={`stage stage-${s.needsAttention ? 'attention' : s.stage}`}>{label}</span>
}

function StageKey() {
  return (
    <div className="stage-key" aria-label="Stages">
      <span className="stage stage-starting">Starting</span>
      <span className="subtle small">under 25%</span>
      <span className="stage stage-building">Building</span>
      <span className="subtle small">25–60%</span>
      <span className="stage stage-sticking">Sticking</span>
      <span className="subtle small">60–90%</span>
      <span className="stage stage-formed">Formed</span>
      <span className="subtle small">90%, kept steadily</span>
    </div>
  )
}

function toFormedText(s: HabitStatus): string {
  if (s.stage === 'upcoming') return `Starts ${weekday(s.habit.startDate)} ${monthDay(s.habit.startDate)}`
  if (s.toFormed === 0) return 'Strong enough: keep 80% of days for four weeks to call it formed'
  return `≈ ${s.toFormed} more repetition${s.toFormed === 1 ? '' : 's'} in a row to formed`
}

function StrengthRow({ status: s, onEdit, today }: { status: HabitStatus; onEdit: () => void; today: string }) {
  const next = MILESTONES.find((m) => m > s.repetitions)
  return (
    <div className="strength-row">
      <div className="strength-head">
        <strong>{s.habit.name}</strong>
        <StageChip status={s} />
        <span className="strength-pct">{Math.round(s.strength * 100)}%</span>
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
        <i className="tick" style={{ left: '25%' }} />
        <i className="tick" style={{ left: '60%' }} />
        <i className="tick goal" style={{ left: '90%' }} />
      </div>
      <p className="subtle small to-formed">{toFormedText(s)}</p>
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
    const histories = liftHistories(activities)
    const goals = settings.liftGoals.map((g) => goalProgress(g, histories, today, settings.units))
    return findWins(activities, trend, statuses, (kg) => formatWeight(kg, settings.units), addDays(today, -30), goals)
  }, [weights, activities, statuses, settings.units, settings.liftGoals, today])
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

// ---------- formed ----------

function Celebration({ status: s }: { status: HabitStatus }) {
  const days = Math.round((Date.parse(s.formedOn!) - Date.parse(s.habit.startDate)) / 86_400_000) + 1
  return (
    <section className="celebrate" role="status">
      <div className="celebrate-mark" aria-hidden="true">
        ✦
      </div>
      <div>
        <h2>{s.habit.name} is formed</h2>
        <p>
          {days} days from the first repetition to automatic, on {longDate(s.formedOn!)}. It now happens on cue with
          little effort. It stays on the Formed shelf for good.
        </p>
      </div>
    </section>
  )
}

function FormedShelf({ formed, today }: { formed: HabitStatus[]; today: string }) {
  return (
    <section className="card">
      <h2>Formed</h2>
      {formed.length === 0 ? (
        <p className="subtle">
          Habits that become automatic land here and stay, with the day they got there. The first one is the hardest.
        </p>
      ) : (
        <ul className="shelf">
          {formed
            .sort((a, b) => a.formedOn!.localeCompare(b.formedOn!))
            .map((s) => (
              <li key={s.habit.id} className={s.needsAttention ? 'attention' : ''}>
                <span className="shelf-mark" aria-hidden="true">
                  ✦
                </span>
                <div>
                  <strong>{s.habit.name}</strong>
                  <div className="subtle small">
                    Formed {longDate(s.formedOn!)} · {s.repetitions} repetitions · {Math.round(s.strength * 100)}% now
                    {!s.habit.active && ' · paused'}
                  </div>
                  {s.needsAttention && (
                    <div className="warn-line small">
                      Slipping. A week of minimum versions brings it back; formed habits recover quickly.
                    </div>
                  )}
                </div>
                {s.formedOn! >= addDays(today, -13) && <span className="new-badge">New</span>}
              </li>
            ))}
        </ul>
      )}
    </section>
  )
}

// ---------- up next ----------

function QueueCard({
  queued,
  statuses,
  today,
  settings,
  onStart,
  onEdit
}: {
  queued: Habit[]
  statuses: HabitStatus[]
  today: string
  settings: PublicSettings
  onStart: (h: Habit) => void
  onEdit: (h: Habit) => void
}) {
  const update = useUpdateSettings()
  const advice = queueAdvice(statuses, today)
  function move(id: string, by: number) {
    const order = [...queued]
    const i = order.findIndex((h) => h.id === id)
    const j = i + by
    if (j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    const pos = new Map(order.map((h, k) => [h.id, k]))
    update.mutate({ habits: settings.habits.map((h) => (pos.has(h.id) ? { ...h, queueOrder: pos.get(h.id)! } : h)) })
  }
  return (
    <section className="card">
      <h2>Up next</h2>
      <p className="subtle small">
        Starting several habits at once makes each one harder. These wait their turn: the next one is suggested once the
        newest habit has held for two weeks on at least 80% of its days.
      </p>
      {queued.length === 0 ? (
        <p className="subtle">
          Nothing queued. Add a habit with <em>Up next</em> ticked, or give an undated Todoist task the @habit label.
        </p>
      ) : (
        <>
          <p className={advice.ready ? 'ready-line' : 'subtle'}>{advice.reason}</p>
          <ol className="queue">
            {queued.map((h, i) => (
              <li key={h.id}>
                <span className={`kind kind-${h.kind}`}>{KIND_LABELS[h.kind]}</span>
                <button className="link" onClick={() => onEdit(h)}>
                  {h.name}
                </button>
                <span className="subtle small">{h.fullMinutes} min</span>
                <span className="queue-actions">
                  <button className="link" aria-label={`Move ${h.name} up`} disabled={i === 0} onClick={() => move(h.id, -1)}>
                    ↑
                  </button>
                  <button
                    className="link"
                    aria-label={`Move ${h.name} down`}
                    disabled={i === queued.length - 1}
                    onClick={() => move(h.id, 1)}
                  >
                    ↓
                  </button>
                  {i === 0 && (
                    <button className={advice.ready ? 'button small' : 'button ghost small'} onClick={() => onStart(h)}>
                      Start
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  )
}

function StartDialog({ habit, today, onClose }: { habit: Habit; today: string; onClose: () => void }) {
  const invalidate = useInvalidate()
  const [days, setDays] = useState<number[]>(habit.days.length ? habit.days : [1, 4])
  const [time, setTime] = useState<string>(habit.time ?? '19:30')
  const [startDate, setStartDate] = useState(today)
  const [minutes, setMinutes] = useState(habit.fullMinutes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function start(e: FormEvent) {
    e.preventDefault()
    if (days.length === 0) return setError('Pick at least one day.')
    setBusy(true)
    setError(null)
    try {
      await api.startHabit(habit.id, { days, time: time || null, startDate, fullMinutes: minutes })
      invalidate('settings')
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={start}>
        <h2>Start {habit.name}</h2>
        <p className="subtle small">
          Two or three short sessions a week is plenty to begin with.
          {(habit.todoistTaskIds ?? []).length > 0 && ' Its Todoist task gets these days and time, so Praxis plans it in.'}
        </p>
        <div className="day-picks">
          {DAY_SHORT.map((d, i) => (
            <label key={d} className="checkbox-row">
              <input
                type="checkbox"
                checked={days.includes(i)}
                onChange={(e) => setDays(e.target.checked ? [...days, i].sort() : days.filter((x) => x !== i))}
              />
              {d}
            </label>
          ))}
        </div>
        <div className="form-row">
          <label>
            Around
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <label>
            Minutes
            <input
              type="number"
              min="1"
              max="600"
              value={minutes}
              onChange={(e) => setMinutes(Math.max(1, Math.round(Number(e.target.value) || 1)))}
            />
          </label>
          <label>
            Starting
            <input type="date" value={startDate} min={today} onChange={(e) => setStartDate(e.target.value)} required />
          </label>
        </div>
        {error && <p className="error small">{error}</p>}
        <div className="row">
          <button className="button" type="submit" disabled={busy}>
            Start
          </button>
          <button className="button ghost" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
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
          and every task labelled <code>@habit</code> becomes a habit here. Ticking it in Todoist or Praxis logs it.
        </p>
      ) : (
        <>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.habitTasks}
              onChange={(e) => update.mutate({ habitTasks: e.target.checked })}
            />
            Take habits from <code>@habit</code> tasks in Todoist
          </label>
          <p className="subtle small">
            Recurring <code>@habit</code> tasks are habits, with their days, time and length. Undated ones wait in Up
            next. Tasks named alike before a colon, such as “Lifting: Upper 1” and “Lifting: Lower 1”, are one habit.
            Ticking the task logs the habit; doing it here, or a synced workout, ticks the task. Change days and times in
            Todoist; the cue and minimum version live here.
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
      {settings.secrets.todoist && (
        <p className="subtle small">
          Or label recurring tasks <code>@habit</code> in Todoist and they appear here on the next sync.
        </p>
      )}
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
  const [queue, setQueue] = useState(false)
  const set = <K extends keyof Habit>(k: K, v: Habit[K]) => setDraft({ ...draft, [k]: v })
  const linked = (draft.todoistTaskIds ?? []).length > 0 && settings.habitTasks && settings.secrets.todoist
  const isQueued = !!draft.queued || queue

  function save(e: FormEvent) {
    e.preventDefault()
    if (!draft.name.trim() || !draft.cue.trim()) return setError('Give the habit a name and a cue.')
    if (draft.days.length === 0 && !isQueued) return setError('Pick at least one day.')
    if (draft.minimumMinutes > draft.fullMinutes) return setError("The minimum can't be longer than the full version.")
    let next = draft
    if (!habit && queue) {
      const last = Math.max(-1, ...settings.habits.filter((h) => h.queued).map((h) => h.queueOrder ?? 0))
      next = { ...draft, active: false, queued: true, queueOrder: last + 1 }
    } else if (habit && !habit.queued && habit.active !== draft.active) {
      next = setActive({ ...draft, active: habit.active }, draft.active, today)
    }
    const habits = habit ? settings.habits.map((h) => (h.id === habit.id ? next : h)) : [...settings.habits, next]
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
            <input
              value={draft.name}
              maxLength={60}
              disabled={!!linked}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Morning row"
            />
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
            <input type="time" value={draft.time ?? ''} disabled={!!linked} onChange={(e) => set('time', e.target.value || null)} />
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
              disabled={!!linked}
              onChange={(e) => {
                const full = Math.max(1, Math.round(Number(e.target.value) || 1))
                setDraft({ ...draft, fullMinutes: full, minimumMinutes: habit ? Math.min(draft.minimumMinutes, full) : defaultMinimum(full) })
              }}
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
                disabled={!!linked}
                onChange={(e) => set('days', e.target.checked ? [...draft.days, i].sort() : draft.days.filter((x) => x !== i))}
              />
              {d}
            </label>
          ))}
        </div>
        {linked && (
          <p className="subtle small">
            Name, days, time and length come from its Todoist task. Change them there. To pause it, remove the task's date;
            to drop it, remove the @habit label.
          </p>
        )}
        {!habit && (
          <label className="checkbox-row">
            <input type="checkbox" checked={queue} onChange={(e) => setQueue(e.target.checked)} />
            Up next: queue it and start it later
          </label>
        )}
        {habit && !habit.queued && !linked && (
          <label className="checkbox-row">
            <input type="checkbox" checked={draft.active} onChange={(e) => set('active', e.target.checked)} />
            Active (untick to pause without losing its history)
          </label>
        )}
        {error && <p className="error small">{error}</p>}
        <div className="row">
          <button className="button" type="submit" disabled={update.isPending}>
            Save
          </button>
          <button className="button ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          {habit && !linked && (
            <button className="button ghost danger-button" type="button" onClick={remove}>
              Delete habit
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

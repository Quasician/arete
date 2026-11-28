import { useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays, daysBetween, toLocalDate } from '@shared/logic'
import { liftHistories, type LiftHistory } from '@shared/progress'
import {
  BODY_REGIONS,
  REGION_LABELS,
  goalProgress,
  metricValue,
  regionProgress,
  suggestedGoals,
  type BodyRegion,
  type GoalMetric,
  type GoalProgress,
  type LiftGoal
} from '@shared/goals'
import type { PublicSettings, Units } from '@shared/types'
import { api, errorText, keys, useSettings, useUpdateSettings } from '../api'
import { longDate, monthDay, weightFromKg, weightToKg } from '../format'
import { Chart, baseOption } from '../components/Chart'
import { BodyMap, type RegionState } from '../components/BodyMap'
import { useChartPalette } from '../theme'
import { useWide } from '../useWide'

const ALL = '1900-01-01'

function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** A goal number in display units: lb or kg for one-rep max, reps, seconds. */
function show(value: number | null, metric: GoalMetric, units: Units): string {
  if (value == null) return '–'
  if (metric === 'e1rm') return `${Math.round(weightFromKg(value, units) * 10) / 10} ${units}`
  if (metric === 'reps') return `${Math.round(value)} reps`
  return value >= 90 ? `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, '0')}` : `${Math.round(value)} s`
}

const STATUS: Record<GoalProgress['status'], string> = {
  'no-exercise': 'Pick its Hevy exercise',
  'no-data': 'No sessions yet',
  'not-started': 'Not started',
  reached: 'Reached',
  ahead: 'Ahead',
  'on-pace': 'On pace',
  behind: 'Behind'
}

export function GoalsPage() {
  const today = toLocalDate(new Date())
  const settings = useSettings().data
  const activities = useQuery({ queryKey: keys.activities(ALL, today), queryFn: () => api.listActivities(ALL, today) })
  const histories = useMemo(() => liftHistories(activities.data ?? []), [activities.data])
  const [hovered, setHovered] = useState<BodyRegion | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<LiftGoal | 'new' | null>(null)
  const wide = useWide()

  const progress = useMemo(
    () => (settings?.liftGoals ?? []).map((g) => goalProgress(g, histories, today, settings!.units)),
    [settings, histories, today]
  )

  if (!settings) return <div className="page" />
  const units = settings.units
  const regions = new Map<BodyRegion, RegionState>()
  for (const [r, v] of regionProgress(progress)) {
    const names = v.goals.map((id) => progress.find((p) => p.goal.id === id)!.goal.label)
    regions.set(r, {
      value: v.value,
      reached: v.goals.every((id) => progress.find((p) => p.goal.id === id)!.status === 'reached'),
      label: names.join(', ')
    })
  }
  const focus = progress.find((p) => p.goal.id === selected) ?? null
  const highlight = new Set<BodyRegion>(focus ? focus.goal.regions : hovered ? [hovered] : [])
  const lit = (p: GoalProgress) => (hovered ? p.goal.regions.includes(hovered) : selected === p.goal.id)
  const reached = progress.filter((p) => p.status === 'reached').length

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Goals</h1>
          <p className="subtle">
            Strength targets read from Hevy: estimated one-rep max for loaded lifts (using the weight as you log it in Hevy), reps
            for bodyweight lifts, seconds for holds.
          </p>
        </div>
        {progress.length > 0 && (
          <div className="row">
            <button className="button ghost" onClick={() => setEditing('new')}>
              + New goal
            </button>
          </div>
        )}
      </header>
      {activities.error && <p className="error">{errorText(activities.error)}</p>}

      {progress.length === 0 ? (
        <SetupCard settings={settings} histories={histories} today={today} />
      ) : (
        <div className="goals-layout">
          <section className="card body-card">
            <div className="card-header">
              <h2>Where you're getting stronger</h2>
              <span className="subtle small">
                {reached} of {progress.length} reached
              </span>
            </div>
            <BodyMap regions={regions} highlight={highlight} onHover={setHovered} />
            <div className="body-legend">
              <span className="swatch idle" /> no goal
              <span className="swatch low" /> started
              <span className="swatch high" /> at target
            </div>
          </section>
          <div className="col">
            <section className="card">
              <h2>Strength block</h2>
              <p className="subtle small">
                {progress[0].goal.startDate <= today
                  ? `Week ${Math.min(Math.floor(daysBetween(progress[0].goal.startDate, today) / 7) + 1, Math.ceil(daysBetween(progress[0].goal.startDate, progress[0].goal.deadline) / 7))} of ${Math.ceil(daysBetween(progress[0].goal.startDate, progress[0].goal.deadline) / 7)}`
                  : `Starts ${longDate(progress[0].goal.startDate)}`}
                {' · '}deadline {longDate(progress[0].goal.deadline)}. The thin mark on each bar is where a steady pace would be
                today.
              </p>
              <ul className="goal-list">
                {progress.map((p) => (
                  <GoalRow
                    key={p.goal.id}
                    p={p}
                    units={units}
                    lit={lit(p)}
                    selected={selected === p.goal.id}
                    onSelect={() => setSelected(selected === p.goal.id ? null : p.goal.id)}
                    onEdit={() => setEditing(p.goal)}
                  />
                ))}
              </ul>
            </section>
            {focus && <GoalChart p={focus} units={units} height={wide ? 340 : 260} />}
          </div>
        </div>
      )}

      {editing && (
        <GoalEditor
          goal={editing === 'new' ? null : editing}
          settings={settings}
          histories={histories}
          today={today}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function GoalRow({
  p,
  units,
  lit,
  selected,
  onSelect,
  onEdit
}: {
  p: GoalProgress
  units: Units
  lit: boolean
  selected: boolean
  onSelect: () => void
  onEdit: () => void
}) {
  const m = p.goal.metric
  return (
    <li className={`goal-row status-${p.status}${lit ? ' lit' : ''}${selected ? ' selected' : ''}`}>
      <button className="goal-main" onClick={onSelect} aria-pressed={selected}>
        <div className="goal-head">
          <strong>{p.goal.label}</strong>
          <span className={`goal-status ${p.status}`}>{STATUS[p.status]}</span>
        </div>
        <div className="goal-numbers">
          <span className="now">{show(p.best?.value ?? p.baseline, m, units)}</span>
          <span className="arrow">→</span>
          <span className="target">{show(p.target, m, units)}</span>
          <span className="subtle small">
            from {show(p.baseline, m, units)}
            {p.latest && p.best && p.latest.date !== p.best.date && ` · last ${show(p.latest.value, m, units)}`}
            {p.reachedOn && ` · reached ${monthDay(p.reachedOn)}`}
          </span>
        </div>
        <div className="goal-bar">
          <div style={{ width: `${Math.max(1, p.progress * 100)}%` }} />
          {p.status !== 'reached' && <i style={{ left: `${p.expected * 100}%` }} />}
        </div>
        <div className="subtle small">
          {p.goal.exercise ?? 'No Hevy exercise picked'} · {p.goal.regions.map((r) => REGION_LABELS[r]).join(', ')}
        </div>
      </button>
      <button className="link goal-edit" onClick={onEdit}>
        Edit
      </button>
    </li>
  )
}

function GoalChart({ p, units, height }: { p: GoalProgress; units: Units; height: number }) {
  const t = useChartPalette()
  const conv = (v: number) => (p.goal.metric === 'e1rm' ? Math.round(weightFromKg(v, units) * 10) / 10 : v)
  const unit = p.goal.metric === 'e1rm' ? units : p.goal.metric === 'reps' ? 'reps' : 'seconds'
  const option = useMemo(
    () => ({
      ...baseOption(t),
      grid: { left: 48, right: 64, top: 28, bottom: 32 },
      xAxis: { type: 'time', min: addDays(p.goal.startDate, -28), max: p.goal.deadline, axisLine: { lineStyle: { color: t.grid } } },
      yAxis: { type: 'value', scale: true, name: unit, splitLine: { lineStyle: { color: t.grid } } },
      series: [
        {
          type: 'line',
          name: p.goal.label,
          data: p.series.map((v) => [v.date, conv(v.value)]),
          symbolSize: 7,
          lineStyle: { color: t.accent, width: 2 },
          itemStyle: { color: t.accent },
          markLine: {
            symbol: 'none',
            silent: true,
            data: [
              ...(p.target != null ? [{ yAxis: conv(p.target), name: 'Target', lineStyle: { color: t.ok, type: 'solid', width: 2 }, label: { formatter: 'target', color: t.ok, position: 'end' } }] : []),
              ...(p.baseline != null ? [{ yAxis: conv(p.baseline), name: 'Start', lineStyle: { color: t.grid, type: 'dashed' }, label: { formatter: 'start', color: t.text, position: 'end' } }] : []),
              { xAxis: p.goal.startDate, lineStyle: { color: t.grid, type: 'dotted' }, label: { show: false } }
            ]
          },
          ...(p.baseline != null && p.target != null
            ? {
                markArea: {
                  silent: true,
                  itemStyle: { color: `${t.ok}1f` },
                  data: [[{ coord: [p.goal.startDate, conv(p.baseline)] }, { coord: [p.goal.deadline, conv(p.target)] }]]
                }
              }
            : {})
        }
      ]
    }),
    [p, units, t]
  )
  return (
    <section className="card">
      <h2>{p.goal.label}</h2>
      <p className="subtle small">
        {p.goal.metric === 'e1rm'
          ? 'Estimated one-rep max from your best set each session (Epley, sets of 12 or fewer).'
          : p.goal.metric === 'reps'
            ? 'Most reps in one set each session.'
            : 'Longest timed set each session.'}{' '}
        The shaded band runs from where you started to the target by the deadline.
      </p>
      <Chart option={option} height={height} />
    </section>
  )
}

// ---------- setting up ----------

function SetupCard({ settings, histories, today }: { settings: PublicSettings; histories: LiftHistory[]; today: string }) {
  const update = useUpdateSettings()
  const [start, setStart] = useState(today)
  const [deadline, setDeadline] = useState(addDays(today, 7 * 13))
  const goals = useMemo(() => suggestedGoals(histories, start, deadline, newId), [histories, start, deadline])
  const preview = goals.map((g) => goalProgress(g, histories, today, settings.units))
  return (
    <section className="card">
      <h2>Set up a strength block</h2>
      <p className="subtle">
        Six goals for strength and tendons rather than size, set from your own recent numbers in Hevy: +10% estimated
        one-rep max on the main lifts, three more pull-ups, and two holds for grip and mobility. Adjust any of them after.
      </p>
      <div className="form-row">
        <label>
          Starts
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          Deadline
          <input type="date" value={deadline} min={addDays(start, 7)} onChange={(e) => setDeadline(e.target.value)} />
        </label>
      </div>
      <table className="table setup-table">
        <thead>
          <tr>
            <th>Goal</th>
            <th>Hevy exercise</th>
            <th>Now</th>
            <th>Target</th>
          </tr>
        </thead>
        <tbody>
          {preview.map((p) => (
            <tr key={p.goal.id}>
              <td>{p.goal.label}</td>
              <td className={p.goal.exercise ? '' : 'subtle'}>{p.goal.exercise ?? 'not found yet: pick it after'}</td>
              <td>{show(p.baseline, p.goal.metric, settings.units)}</td>
              <td>
                <strong>{show(p.target, p.goal.metric, settings.units)}</strong>
                {p.target == null && <span className="subtle small"> (once there's a first session)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="button"
        disabled={deadline <= start}
        onClick={() => update.mutate({ liftGoals: goals })}
      >
        Add these goals
      </button>
      {update.error && <p className="error small">{errorText(update.error)}</p>}
    </section>
  )
}

function GoalEditor({
  goal,
  settings,
  histories,
  today,
  onClose
}: {
  goal: LiftGoal | null
  settings: PublicSettings
  histories: LiftHistory[]
  today: string
  onClose: () => void
}) {
  const update = useUpdateSettings()
  const units = settings.units
  const first = settings.liftGoals[0]
  const [draft, setDraft] = useState<LiftGoal>(
    goal ?? {
      id: newId(),
      label: '',
      exercise: null,
      metric: 'e1rm',
      regions: [],
      startDate: first?.startDate ?? today,
      deadline: first?.deadline ?? addDays(today, 7 * 12),
      baseline: null,
      target: null,
      rule: { pct: 10 }
    }
  )
  const toShown = (v: number | null) => (v == null ? '' : String(draft.metric === 'e1rm' ? Math.round(weightFromKg(v, units) * 10) / 10 : v))
  const fromShown = (s: string) => (s.trim() === '' ? null : draft.metric === 'e1rm' ? weightToKg(Number(s), units) : Number(s))
  const [baseline, setBaseline] = useState(toShown(draft.baseline))
  const [target, setTarget] = useState(toShown(draft.target))
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof LiftGoal>(k: K, v: LiftGoal[K]) => setDraft({ ...draft, [k]: v })
  const exercises = histories.filter((h) => h.points.some((p) => metricValue(p, draft.metric) != null) || h.name === draft.exercise)
  const unit = draft.metric === 'e1rm' ? units : draft.metric === 'reps' ? 'reps' : 'seconds'

  function save(e: FormEvent) {
    e.preventDefault()
    if (!draft.label.trim()) return setError('Give the goal a name.')
    if (draft.deadline <= draft.startDate) return setError('The deadline has to come after the start.')
    const b = fromShown(baseline)
    const t = fromShown(target)
    if ((b != null && !(b >= 0)) || (t != null && !(t > 0))) return setError('Numbers only, please.')
    const next = { ...draft, label: draft.label.trim(), baseline: b, target: t }
    const goals = goal ? settings.liftGoals.map((g) => (g.id === goal.id ? next : g)) : [...settings.liftGoals, next]
    update.mutate({ liftGoals: goals }, { onSuccess: onClose, onError: (err) => setError(errorText(err)) })
  }
  function remove() {
    if (!goal || !window.confirm(`Delete the goal "${goal.label}"? Your Hevy history stays.`)) return
    update.mutate({ liftGoals: settings.liftGoals.filter((g) => g.id !== goal.id) }, { onSuccess: onClose })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>{goal ? 'Edit goal' : 'New goal'}</h2>
        <div className="form-row">
          <label className="grow">
            Name
            <input value={draft.label} maxLength={60} onChange={(e) => set('label', e.target.value)} placeholder="e.g. DB bench press" />
          </label>
          <label>
            Measured by
            <select value={draft.metric} onChange={(e) => setDraft({ ...draft, metric: e.target.value as GoalMetric, baseline: null, target: null })}>
              <option value="e1rm">Estimated one-rep max</option>
              <option value="reps">Reps in one set</option>
              <option value="seconds">Seconds held</option>
            </select>
          </label>
        </div>
        <label>
          Hevy exercise
          <select value={draft.exercise ?? ''} onChange={(e) => set('exercise', e.target.value || null)}>
            <option value="">Not picked yet</option>
            {exercises.map((h) => (
              <option key={h.name} value={h.name}>
                {h.name} ({h.sessions})
              </option>
            ))}
          </select>
        </label>
        {draft.metric === 'seconds' && (
          <p className="subtle small">For holds, log a timed exercise in Hevy (for example a custom “Deep Squat Hold”).</p>
        )}
        <div className="form-row">
          <label>
            Start ({unit})
            <input value={baseline} inputMode="decimal" placeholder="from history" onChange={(e) => setBaseline(e.target.value)} />
          </label>
          <label>
            Target ({unit})
            <input value={target} inputMode="decimal" placeholder={draft.rule.pct ? `+${draft.rule.pct}%` : draft.rule.add ? `+${draft.rule.add}` : ''} onChange={(e) => setTarget(e.target.value)} />
          </label>
          <label>
            Starts
            <input type="date" value={draft.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </label>
          <label>
            Deadline
            <input type="date" value={draft.deadline} onChange={(e) => set('deadline', e.target.value)} />
          </label>
        </div>
        <p className="subtle small">Leave the start blank to use your best from the four weeks before it, and the target blank to add {draft.rule.pct ? `${draft.rule.pct}%` : draft.rule.add ? draft.rule.add : 'nothing'}.</p>
        <fieldset className="region-picks">
          <legend>Muscle groups it trains</legend>
          {BODY_REGIONS.map((r) => (
            <label key={r} className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.regions.includes(r)}
                onChange={(e) => set('regions', e.target.checked ? [...draft.regions, r] : draft.regions.filter((x) => x !== r))}
              />
              {REGION_LABELS[r]}
            </label>
          ))}
        </fieldset>
        {error && <p className="error small">{error}</p>}
        <div className="row">
          <button className="button" type="submit" disabled={update.isPending}>
            Save
          </button>
          <button className="button ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          {goal && (
            <button className="button ghost danger-button" type="button" onClick={remove}>
              Delete goal
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

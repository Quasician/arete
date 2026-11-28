import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays, formatDuration, morningTrend, toLocalDate, weekStartOf } from '@shared/logic'
import {
  GUIDELINE_MAX,
  GUIDELINE_MIN,
  VO2_PERCENTILES,
  estimateVo2Max,
  isTwoKTest,
  liftHistories,
  vo2Percentile,
  weeklyMinutes,
  type LiftHistory
} from '@shared/progress'
import type { Activity, Meal, PublicSettings, WeightEntry } from '@shared/types'
import { MIN_LOGGED_DAYS, MIN_MEALS_PER_DAY, WINDOW_DAYS, balanceAt, balanceSeries, loggedDays } from '@shared/energy'
import { api, errorText, keys, useSettings } from '../api'
import { useUi } from '../store'
import { longDate, monthDay, weightFromKg } from '../format'
import { Chart, baseOption } from '../components/Chart'
import { useChartPalette } from '../theme'
import { TREND_DAYS } from '../components/TrendCharts'
import { useWide } from '../useWide'

const WEEKS = 16
const ALL = '1900-01-01'

export function ProgressPage() {
  const today = toLocalDate(new Date())
  const settings = useSettings().data
  const activities = useQuery({ queryKey: keys.activities(ALL, today), queryFn: () => api.listActivities(ALL, today) })
  const weights = useQuery({ queryKey: keys.weights(ALL, today), queryFn: () => api.listWeights(ALL, today) })
  const mealsFrom = addDays(today, -7 * WEEKS - 21)
  const meals = useQuery({
    queryKey: ['meals', 'range', mealsFrom, today],
    queryFn: () => api.listMealsRange(mealsFrom, today)
  })

  if (!settings) return <div className="page" />
  const error = activities.error ?? weights.error ?? meals.error

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Progress</h1>
          <p className="subtle">Training volume, strength and aerobic fitness over time.</p>
        </div>
      </header>
      {error && <p className="error">{errorText(error)}</p>}
      <div className="two-col">
        <div className="col">
          <MinutesCard activities={activities.data ?? []} settings={settings} today={today} />
          <StrengthCard activities={activities.data ?? []} settings={settings} />
        </div>
        <div className="col">
          <EnergyCard meals={meals.data ?? []} weights={weights.data ?? []} settings={settings} today={today} />
          <AerobicCard activities={activities.data ?? []} weights={weights.data ?? []} settings={settings} />
        </div>
      </div>
    </div>
  )
}

// ---------- weekly active minutes ----------

function MinutesCard({ activities, settings, today }: { activities: Activity[]; settings: PublicSettings; today: string }) {
  const setPage = useUi((s) => s.setPage)
  const wide = useWide()
  const chartTheme = useChartPalette()
  const weeks = useMemo(
    () => weeklyMinutes(activities, settings.typicalMinutes, WEEKS, today),
    [activities, settings.typicalMinutes, today]
  )
  const thisWeek = weekStartOf(today)
  const complete = weeks.filter((w) => w.weekStart < thisWeek).slice(-8)
  const average = complete.length
    ? Math.round(complete.reduce((s, w) => s + w.measured + w.estimated, 0) / complete.length)
    : null
  const uncounted = weeks.reduce((s, w) => s + w.uncounted, 0)

  const option = useMemo(
    () => ({
      ...baseOption(chartTheme),
      legend: { top: 0, right: 0, textStyle: { color: chartTheme.text } },
      xAxis: {
        type: 'category',
        data: weeks.map((w) => monthDay(w.weekStart)),
        axisLine: { lineStyle: { color: chartTheme.grid } }
      },
      yAxis: { type: 'value', name: 'min', splitLine: { lineStyle: { color: chartTheme.grid } } },
      series: [
        {
          name: 'Recorded',
          type: 'bar',
          stack: 'm',
          data: weeks.map((w) => w.measured),
          itemStyle: { color: chartTheme.primary },
          markArea: {
            silent: true,
            itemStyle: { color: chartTheme.ok, opacity: 0.1 },
            label: { show: true, position: 'insideTopLeft', color: chartTheme.ok, formatter: 'Guideline 150–300' },
            data: [[{ yAxis: GUIDELINE_MIN }, { yAxis: GUIDELINE_MAX }]]
          },
          markLine:
            average == null
              ? undefined
              : {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { color: chartTheme.accent, type: 'dashed' },
                  label: { color: chartTheme.accent, position: 'insideEndTop', formatter: `Your 8-week average: ${average}` },
                  data: [{ yAxis: average }]
                }
        },
        {
          name: 'From typical lengths',
          type: 'bar',
          stack: 'm',
          data: weeks.map((w) => w.estimated),
          itemStyle: { color: chartTheme.muted }
        }
      ]
    }),
    [weeks, average, chartTheme]
  )

  return (
    <section className="card">
      <h2>Active minutes per week</h2>
      <p className="subtle small">
        The green band is the U.S. guideline of 150–300 minutes of moderate activity a week. Hevy sessions count their
        whole length, rests included.
      </p>
      <Chart option={option} height={wide ? 360 : 280} />
      {uncounted > 0 && (
        <p className="subtle small">
          {uncounted} session{uncounted === 1 ? '' : 's'} in this period had no length, so {uncounted === 1 ? "it isn't" : "they aren't"}{' '}
          counted. Set typical session lengths in{' '}
          <button className="link" onClick={() => setPage('settings')}>
            Settings
          </button>{' '}
          to fill them in.
        </p>
      )}
    </section>
  )
}

// ---------- strength ----------

function StrengthCard({ activities, settings }: { activities: Activity[]; settings: PublicSettings }) {
  const histories = useMemo(() => liftHistories(activities), [activities])
  const [picked, setPicked] = useState<string | null>(null)
  const wide = useWide()
  const lift = histories.find((h) => h.name === picked) ?? histories[0]

  return (
    <section className="card">
      <div className="card-header">
        <h2>Strength</h2>
        {histories.length > 0 && (
          <select value={lift?.name} onChange={(e) => setPicked(e.target.value)}>
            {histories.map((h) => (
              <option key={h.name} value={h.name}>
                {h.name} ({h.sessions})
              </option>
            ))}
          </select>
        )}
      </div>
      {!lift ? (
        <p className="subtle">
          Strength charts fill in once Hevy workouts have synced. Add your Hevy key in Settings → Connections.
        </p>
      ) : (
        <>
          <p className="subtle small">
            {lift.byReps
              ? 'Most reps in a single set each session.'
              : 'Estimated one-rep max from your best set each session (Epley formula, sets of 12 reps or fewer). For dumbbells this is per dumbbell, as Hevy logs it.'}
          </p>
          <LiftChart lift={lift} units={settings.units} height={wide ? 360 : 260} />
          <LiftStats lift={lift} units={settings.units} />
        </>
      )}
    </section>
  )
}

function liftValue(lift: LiftHistory, p: LiftHistory['points'][number], units: PublicSettings['units']): number | null {
  if (lift.byReps) return p.bestReps
  return p.e1rmKg == null ? null : Number(weightFromKg(p.e1rmKg, units).toFixed(1))
}

function LiftChart({ lift, units, height }: { lift: LiftHistory; units: PublicSettings['units']; height: number }) {
  const chartTheme = useChartPalette()
  const option = useMemo(
    () => ({
      ...baseOption(chartTheme),
      xAxis: { type: 'time', axisLine: { lineStyle: { color: chartTheme.grid } } },
      yAxis: {
        type: 'value',
        scale: true,
        name: lift.byReps ? 'reps' : units,
        splitLine: { lineStyle: { color: chartTheme.grid } }
      },
      series: [
        {
          type: 'line',
          data: lift.points.map((p) => [p.date, liftValue(lift, p, units)]).filter(([, v]) => v != null),
          symbolSize: 7,
          lineStyle: { color: chartTheme.accent, width: 2 },
          itemStyle: { color: chartTheme.accent }
        }
      ]
    }),
    [lift, units, chartTheme]
  )
  return <Chart option={option} height={height} />
}

function LiftStats({ lift, units }: { lift: LiftHistory; units: PublicSettings['units'] }) {
  const values = lift.points.map((p) => ({ date: p.date, v: liftValue(lift, p, units) })).filter((x) => x.v != null) as {
    date: string
    v: number
  }[]
  if (values.length === 0) return null
  const latest = values.at(-1)!
  const best = values.reduce((a, b) => (b.v > a.v ? b : a))
  const eightWeeksAgo = [...values].reverse().find((x) => x.date <= addDays(latest.date, -56))
  const unit = lift.byReps ? 'reps' : units
  return (
    <div className="mini-stats three">
      <Mini value={`${latest.v} ${unit}`} label={`latest, ${monthDay(latest.date)}`} />
      <Mini value={`${best.v} ${unit}`} label={`best, ${monthDay(best.date)}`} />
      <Mini
        value={
          eightWeeksAgo ? `${latest.v - eightWeeksAgo.v >= 0 ? '+' : ''}${(latest.v - eightWeeksAgo.v).toFixed(lift.byReps ? 0 : 1)} ${unit}` : '–'
        }
        label="vs. 8 weeks earlier"
      />
    </div>
  )
}

// ---------- calories vs. weight ----------

function EnergyCard({
  meals,
  weights,
  settings,
  today
}: {
  meals: Meal[]
  weights: WeightEntry[]
  settings: PublicSettings
  today: string
}) {
  const wide = useWide()
  const chartTheme = useChartPalette()
  const setPage = useUi((s) => s.setPage)
  const days = useMemo(() => loggedDays(meals), [meals])
  const trend = useMemo(() => morningTrend(weights, TREND_DAYS).trend, [weights])
  const latest = useMemo(() => balanceAt(today, days, trend), [today, days, trend])
  const series = useMemo(() => balanceSeries(days, trend, today, WEEKS), [days, trend, today])
  const recentLogged = days.filter((d) => d.date > addDays(today, -WINDOW_DAYS)).length

  const option = useMemo(
    () => ({
      ...baseOption(chartTheme),
      legend: { top: 0, right: 0, textStyle: { color: chartTheme.text } },
      xAxis: { type: 'category', data: series.map((p) => monthDay(p.end)), axisLine: { lineStyle: { color: chartTheme.grid } } },
      yAxis: { type: 'value', name: 'kcal/day', scale: true, splitLine: { lineStyle: { color: chartTheme.grid } } },
      series: [
        {
          name: 'Eaten (week average)',
          type: 'bar',
          data: series.map((p) => p.weekIntake),
          itemStyle: { color: chartTheme.muted }
        },
        {
          name: 'Burned (estimate)',
          type: 'line',
          data: series.map((p) => p.burn),
          connectNulls: true,
          symbolSize: 7,
          lineStyle: { color: chartTheme.accent, width: 2 },
          itemStyle: { color: chartTheme.accent }
        }
      ]
    }),
    [series, chartTheme]
  )

  const perWeek = latest ? weightFromKg((latest.weightChangeKg / WINDOW_DAYS) * 7, settings.units) : null

  return (
    <section className="card">
      <h2>Calories vs. weight</h2>
      {latest ? (
        <>
          <div className="mini-stats three">
            <Mini value={`${latest.burn.toLocaleString()}`} label="estimated burn, kcal/day" />
            <Mini value={`${latest.intake.toLocaleString()}`} label="eaten, kcal/day" />
            <Mini
              value={`${perWeek! > 0 ? '+' : ''}${perWeek!.toFixed(1)} ${settings.units}`}
              label="trend weight per week"
            />
          </div>
          <p className="subtle small">
            Over the last {WINDOW_DAYS} days ({latest.loggedDays} logged), you ate about {latest.intake.toLocaleString()}{' '}
            kcal a day and your trend weight {perWeek! <= 0 ? 'fell' : 'rose'} {Math.abs(perWeek!).toFixed(1)}{' '}
            {settings.units} a week, so you burned about {latest.burn.toLocaleString()} kcal a day.
          </p>
          <Chart option={option} height={wide ? 300 : 240} />
        </>
      ) : (
        <p className="subtle">
          This needs {MIN_LOGGED_DAYS} logged days in the last {WINDOW_DAYS} (a day counts once it has at least{' '}
          {MIN_MEALS_PER_DAY} meals with calories) plus your weight trend. So far: {recentLogged} of {MIN_LOGGED_DAYS}{' '}
          days. Log meals on the{' '}
          <button className="link" onClick={() => setPage('food')}>
            Food
          </button>{' '}
          page.
        </p>
      )}
      <p className="subtle small">
        Burn = average eaten − weight change × 7,700 kcal per kg, spread over the {WINDOW_DAYS} days. Consistent logging
        matters more than precise numbers: if you always under-count by the same amount, the burn reads low by the same
        amount, so the gap between the two lines still tells you whether to eat more or less.
      </p>
    </section>
  )
}

// ---------- aerobic fitness ----------

function AerobicCard({
  activities,
  weights,
  settings
}: {
  activities: Activity[]
  weights: WeightEntry[]
  settings: PublicSettings
}) {
  const wide = useWide()
  const chartTheme = useChartPalette()
  const trend = useMemo(() => morningTrend(weights, TREND_DAYS).trend, [weights])
  const tests = useMemo(() => {
    const weightOn = (date: string) => {
      const before = [...trend].reverse().find((p) => p.date <= date)
      return (before ?? trend[0])?.value ?? null
    }
    return activities
      .filter(isTwoKTest)
      .map((a) => {
        const kg = weightOn(a.date)
        return { date: a.date, timeSec: a.durationSec!, kg, vo2: kg ? estimateVo2Max(a.durationSec!, kg, settings.rowingLevel) : null }
      })
      .sort((x, y) => x.date.localeCompare(y.date))
  }, [activities, trend, settings.rowingLevel])
  const scored = tests.filter((t) => t.vo2 != null) as { date: string; timeSec: number; kg: number; vo2: number }[]
  const latest = scored.at(-1)
  const ref = VO2_PERCENTILES[settings.ageGroup]

  const option = useMemo(() => {
    const lines = [
      { p: 50, color: chartTheme.text },
      { p: 75, color: chartTheme.text },
      { p: 90, color: chartTheme.ok },
      { p: 95, color: chartTheme.accent }
    ]
    return {
      ...baseOption(chartTheme),
      xAxis: { type: 'time', axisLine: { lineStyle: { color: chartTheme.grid } } },
      yAxis: {
        type: 'value',
        name: 'mL/kg/min',
        min: Math.floor(Math.min(ref[50], ...scored.map((t) => t.vo2)) - 4),
        max: Math.ceil(Math.max(ref[95], ...scored.map((t) => t.vo2)) + 3),
        splitLine: { lineStyle: { color: chartTheme.grid } }
      },
      series: [
        {
          type: 'line',
          data: scored.map((t) => [t.date, Number(t.vo2.toFixed(1))]),
          symbolSize: 9,
          lineStyle: { color: chartTheme.primary, width: 2 },
          itemStyle: { color: chartTheme.primary },
          markLine: {
            silent: true,
            symbol: 'none',
            data: lines.map((l) => ({
              yAxis: ref[l.p],
              lineStyle: { color: l.color, type: 'dashed', opacity: 0.7 },
              label: { color: l.color, formatter: `${l.p}th: ${ref[l.p]}`, position: 'insideEndTop' }
            }))
          }
        }
      ]
    }
  }, [scored, ref, chartTheme])

  return (
    <section className="card">
      <h2>Aerobic fitness (VO2max)</h2>
      {latest ? (
        <>
          <div className="mini-stats three">
            <Mini value={`${latest.vo2.toFixed(1)}`} label="latest estimate, mL/kg/min" />
            <Mini value={`${ordinal(vo2Percentile(latest.vo2, settings.ageGroup))}`} label={`percentile, men ${settings.ageGroup}`} />
            <Mini value={formatDuration(latest.timeSec)} label={`2,000 m on ${monthDay(latest.date)}`} />
          </div>
          <Chart option={option} height={wide ? 360 : 260} />
          <p className="subtle small">
            Estimated with Concept2's formula from your 2,000 m time and your trend weight that day (training level:{' '}
            {settings.rowingLevel === 'high' ? 'highly trained' : 'not highly trained'}, changeable in Settings). Reference
            lines are men's percentiles from lab treadmill tests (FRIEND registry), which usually read a little higher than
            rowing, so treat the comparison as approximate.
          </p>
        </>
      ) : (
        <p className="subtle">
          No 2,000 m test yet. Arete picks one up automatically from Concept2 once you row a single, continuous 2,000 m
          piece.
        </p>
      )}
      <TestProtocol lastTest={latest?.date ?? null} />
    </section>
  )
}

function TestProtocol({ lastTest }: { lastTest: string | null }) {
  const next = lastTest ? addDays(lastTest, 42) : null
  return (
    <div className="protocol">
      <h3>How to test</h3>
      <ol>
        <li>
          <strong>Time:</strong> about 25 minutes in all: a 10-minute warm-up (easy rowing with two or three short
          pushes at test pace), the 2,000 m piece itself (roughly 7–8 minutes), then 5 minutes easy.
        </li>
        <li>
          <strong>Resistance:</strong> damper 3–5, which Concept2 generally recommends. Better still, check the drag
          factor on the monitor (around 120–135 is typical for men) and use the same number every test, so results
          compare. Concept2's advice for the test itself is whatever setting gives you your best time.
        </li>
        <li>
          <strong>On the monitor:</strong> Select Workout → New Workout → Single Distance → 2000 m. Row it as one
          continuous, all-out but evenly paced piece; Arete ignores interval workouts.
        </li>
        <li>
          <strong>When:</strong> rested, not the day after hard legs, at a similar time of day each test. Every 6–8
          weeks is enough to see change.
          {next && ` Next suggested test: ${longDate(next)}.`}
        </li>
      </ol>
    </div>
  )
}

function Mini({ value, label }: { value: string; label: string }) {
  return (
    <div className="mini-stat">
      <div className="mini-stat-value">{value}</div>
      <div className="mini-stat-label">{label}</div>
    </div>
  )
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

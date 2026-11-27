import { useMemo } from 'react'
import { formatPace } from '@shared/logic'
import type { Activity, Units, WeightEntry } from '@shared/types'
import type { Point } from '@shared/logic'
import { weightFromKg } from '../format'
import { Chart, baseOption, chartTheme } from './Chart'

export const TREND_DAYS = 7

export function WeightChart({
  entries,
  trend,
  units,
  height = 300,
  compact = false
}: {
  entries: WeightEntry[]
  trend: Point[]
  units: Units
  height?: number
  compact?: boolean
}) {
  const option = useMemo(() => {
    const conv = (kg: number) => Number(weightFromKg(kg, units).toFixed(1))
    return {
      ...baseOption(),
      legend: compact ? undefined : { top: 0, right: 0, textStyle: { color: chartTheme.text } },
      grid: compact ? { left: 40, right: 8, top: 12, bottom: 24 } : (baseOption().grid as object),
      xAxis: { type: 'time', axisLine: { lineStyle: { color: chartTheme.grid } } },
      yAxis: {
        type: 'value',
        scale: true,
        name: compact ? undefined : units,
        splitLine: { lineStyle: { color: chartTheme.grid } }
      },
      series: [
        {
          name: 'Weigh-ins',
          type: 'scatter',
          data: entries.map((e) => [e.date, conv(e.kg)]),
          symbolSize: compact ? 4 : 6,
          itemStyle: { color: chartTheme.muted }
        },
        {
          name: `${TREND_DAYS}-day trend`,
          type: 'line',
          data: trend.map((p) => [p.date, conv(p.value)]),
          showSymbol: false,
          smooth: true,
          lineStyle: { color: chartTheme.accent, width: compact ? 2 : 3 },
          itemStyle: { color: chartTheme.accent }
        }
      ]
    }
  }, [entries, trend, units, compact])
  return <Chart option={option} height={height} />
}

export function PaceChart({ rows, height = 240 }: { rows: Activity[]; height?: number }) {
  const option = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
    return {
      ...baseOption(),
      xAxis: {
        type: 'category',
        data: sorted.map((r) => r.date.slice(5)),
        axisLine: { lineStyle: { color: chartTheme.grid } }
      },
      yAxis: {
        type: 'value',
        inverse: true,
        scale: true,
        splitLine: { lineStyle: { color: chartTheme.grid } },
        axisLabel: { formatter: (v: number) => formatPace(v).replace(' /500m', '') }
      },
      tooltip: {
        ...(baseOption().tooltip as object),
        valueFormatter: (v: number) => formatPace(v)
      },
      series: [
        {
          type: 'line',
          data: sorted.map((r) => r.detail.paceSecPer500),
          symbolSize: 7,
          lineStyle: { color: chartTheme.primary, width: 2 },
          itemStyle: { color: chartTheme.primary }
        }
      ]
    }
  }, [rows])
  return <Chart option={option} height={height} />
}

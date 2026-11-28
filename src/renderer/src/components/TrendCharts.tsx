import { useMemo } from 'react'
import { MORNING_BEFORE_HOUR, formatPace, readingHour } from '@shared/logic'
import type { Activity, Units, WeightEntry } from '@shared/types'
import type { MorningPoint, Point } from '@shared/logic'
import { weightFromKg } from '../format'
import { Chart, baseOption } from './Chart'
import { useChartPalette } from '../theme'

export const TREND_DAYS = 7

export function WeightChart({
  entries,
  daily,
  trend,
  units,
  height = 300,
  compact = false
}: {
  entries: WeightEntry[]
  daily: MorningPoint[]
  trend: Point[]
  units: Units
  height?: number
  compact?: boolean
}) {
  const chartTheme = useChartPalette()
  const option = useMemo(() => {
    const conv = (kg: number) => Number(weightFromKg(kg, units).toFixed(1))
    return {
      ...baseOption(chartTheme),
      legend: compact ? undefined : { top: 0, right: 0, textStyle: { color: chartTheme.text } },
      grid: compact ? { left: 40, right: 8, top: 12, bottom: 24 } : (baseOption(chartTheme).grid as object),
      xAxis: { type: 'time', axisLine: { lineStyle: { color: chartTheme.grid } } },
      yAxis: {
        type: 'value',
        scale: true,
        name: compact ? undefined : units,
        splitLine: { lineStyle: { color: chartTheme.grid } }
      },
      series: [
        {
          name: 'Morning',
          type: 'scatter',
          data: daily.filter((p) => !p.estimated).map((p) => [p.date, conv(p.value)]),
          symbolSize: compact ? 4 : 6,
          itemStyle: { color: chartTheme.primary, opacity: 0.75 }
        },
        {
          name: 'Evening',
          type: 'scatter',
          data: entries
            .filter((e) => readingHour(e.measuredAt) >= MORNING_BEFORE_HOUR)
            .map((e) => [e.date, conv(e.kg)]),
          symbolSize: compact ? 3 : 5,
          itemStyle: { color: chartTheme.text, opacity: 0.25 }
        },
        {
          name: 'Morning, estimated',
          type: 'scatter',
          data: daily.filter((p) => p.estimated).map((p) => [p.date, conv(p.value)]),
          symbolSize: compact ? 4 : 6,
          itemStyle: { color: 'transparent', borderColor: chartTheme.primary, borderWidth: 1.5 }
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
  }, [entries, daily, trend, units, compact, chartTheme])
  return <Chart option={option} height={height} />
}

export function PaceChart({ rows, height = 240 }: { rows: Activity[]; height?: number }) {
  const chartTheme = useChartPalette()
  const option = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
    return {
      ...baseOption(chartTheme),
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
        ...(baseOption(chartTheme).tooltip as object),
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
  }, [rows, chartTheme])
  return <Chart option={option} height={height} />
}

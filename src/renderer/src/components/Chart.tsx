import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkAreaComponent,
  CanvasRenderer
])

/** Shared look for every chart, matched to the app's dark theme. */
export const chartTheme = {
  text: '#a9b4d0',
  grid: 'rgba(169, 180, 208, 0.12)',
  accent: '#f2c86b',
  primary: '#7aa7ff',
  muted: 'rgba(122, 167, 255, 0.35)'
}

export function baseOption(): EChartsCoreOption {
  return {
    backgroundColor: 'transparent',
    textStyle: { color: chartTheme.text, fontFamily: 'inherit' },
    grid: { left: 48, right: 16, top: 28, bottom: 32 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#141b33',
      borderColor: '#2a3558',
      textStyle: { color: '#e8ecf7' }
    }
  }
}

export function Chart({ option, height = 280 }: { option: EChartsCoreOption; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const instance = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    chart.current = instance
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(ref.current)
    return () => {
      observer.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true })
  }, [option])

  return <div ref={ref} style={{ width: '100%', height }} />
}

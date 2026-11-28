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
import type { ChartPalette } from '../theme'

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

/** Shared look for every chart, in the current theme's colours. */
export function baseOption(t: ChartPalette): EChartsCoreOption {
  return {
    backgroundColor: 'transparent',
    textStyle: { color: t.text, fontFamily: 'inherit' },
    grid: { left: 48, right: 16, top: 28, bottom: 32 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: t.tooltipBg,
      borderColor: t.tooltipBorder,
      textStyle: { color: t.tooltipText }
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

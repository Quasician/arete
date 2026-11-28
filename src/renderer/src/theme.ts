// Applies the lighting theme for the time of day and keeps it current.
import { useEffect } from 'react'
import { create } from 'zustand'
import { guessLocation, phaseAt, type Phase } from '@shared/sun'
import type { PublicSettings } from '@shared/types'

export type ThemeName = Phase

interface ThemeState {
  name: ThemeName
  set: (name: ThemeName) => void
}

export const useTheme = create<ThemeState>((set) => ({
  name: 'night',
  set: (name) => set({ name })
}))

export function currentTheme(settings: Pick<PublicSettings, 'themeMode' | 'sunLocation'> | undefined, now = new Date()): ThemeName {
  if (settings?.themeMode === 'light') return 'day'
  if (settings?.themeMode === 'dark') return 'night'
  return phaseAt(now, settings?.sunLocation ?? guessLocation(now))
}

/** Keeps <html data-theme> in step with the time of day, checking every minute. */
export function useThemeController(settings: PublicSettings | undefined): void {
  const setName = useTheme((s) => s.set)
  useEffect(() => {
    const apply = () => {
      const name = currentTheme(settings)
      if (document.documentElement.dataset.theme !== name) {
        // Fade colours over the change instead of snapping.
        document.documentElement.classList.add('theme-fade')
        document.documentElement.dataset.theme = name
        window.setTimeout(() => document.documentElement.classList.remove('theme-fade'), 1600)
      }
      setName(name)
    }
    apply()
    const timer = window.setInterval(apply, 60_000)
    return () => window.clearInterval(timer)
  }, [settings?.themeMode, settings?.sunLocation?.lat, settings?.sunLocation?.lon, setName])
}

/** Chart colours for each theme, matching the CSS variables in styles.css. */
export interface ChartPalette {
  text: string
  grid: string
  accent: string
  primary: string
  muted: string
  ok: string
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
}

const DARK_BASE = {
  tooltipBg: '#141b33',
  tooltipBorder: '#2a3558',
  tooltipText: '#e8ecf7'
}
const LIGHT_BASE = {
  tooltipBg: '#ffffff',
  tooltipBorder: '#d3dcec',
  tooltipText: '#1b2540'
}

export const CHART_PALETTES: Record<ThemeName, ChartPalette> = {
  night: {
    ...DARK_BASE,
    text: '#a9b4d0',
    grid: 'rgba(169, 180, 208, 0.12)',
    accent: '#f2c86b',
    primary: '#7aa7ff',
    muted: 'rgba(122, 167, 255, 0.35)',
    ok: '#7fd1a6'
  },
  dusk: {
    ...DARK_BASE,
    tooltipBg: '#221b40',
    tooltipBorder: '#3a3166',
    text: '#b6aed3',
    grid: 'rgba(182, 174, 211, 0.13)',
    accent: '#f3b27a',
    primary: '#a796ff',
    muted: 'rgba(167, 150, 255, 0.35)',
    ok: '#86d4ad'
  },
  dawn: {
    ...LIGHT_BASE,
    text: '#5f5876',
    grid: 'rgba(60, 50, 90, 0.10)',
    accent: '#c27a4a',
    primary: '#4c63c9',
    muted: 'rgba(76, 99, 201, 0.35)',
    ok: '#2f8f62'
  },
  day: {
    ...LIGHT_BASE,
    text: '#5d6a88',
    grid: 'rgba(20, 40, 90, 0.09)',
    accent: '#b9861f',
    primary: '#2f5fd0',
    muted: 'rgba(47, 95, 208, 0.32)',
    ok: '#2f9a68'
  },
  golden: {
    ...LIGHT_BASE,
    tooltipBorder: '#e5d3b3',
    tooltipText: '#2e2416',
    text: '#75664d',
    grid: 'rgba(90, 60, 20, 0.10)',
    accent: '#b8741a',
    primary: '#3d5bb8',
    muted: 'rgba(61, 91, 184, 0.32)',
    ok: '#3a8a5a'
  }
}

export function useChartPalette(): ChartPalette {
  const name = useTheme((s) => s.name)
  return CHART_PALETTES[name]
}

import { KG_PER_LB } from '@shared/logic'
import type { Units } from '@shared/types'

export function weightFromKg(kg: number, units: Units): number {
  return units === 'lb' ? kg / KG_PER_LB : kg
}

export function weightToKg(value: number, units: Units): number {
  return units === 'lb' ? value * KG_PER_LB : value
}

export function formatWeight(kg: number, units: Units): string {
  return `${weightFromKg(kg, units).toFixed(1)} ${units}`
}

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' })
const MONTH_DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
const LONG = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC'
})

function asUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

export const weekday = (date: string) => WEEKDAY.format(asUtc(date))
export const monthDay = (date: string) => MONTH_DAY.format(asUtc(date))
export const longDate = (date: string) => LONG.format(asUtc(date))

export function formatDistance(m: number | null): string {
  if (m == null) return ''
  return m >= 10_000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m).toLocaleString()} m`
}

export function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

// Sunrise, sunset and the time-of-day lighting phase, so Arete's colours can
// follow the day: light in the morning and afternoon, dark at night.

export type Phase = 'dawn' | 'day' | 'golden' | 'dusk' | 'night'

export interface Location {
  lat: number
  lon: number
}

const RAD = Math.PI / 180

/**
 * Sunrise and sunset for the local calendar day containing `date`, using
 * NOAA's general solar position equations (accurate to a few minutes).
 */
export function sunTimes(date: Date, { lat, lon }: Location): { sunrise: Date; sunset: Date } {
  const start = new Date(date.getFullYear(), 0, 1)
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86_400_000) + 1
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1)
  const eqTime =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g)
  const cosHa = Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl)
  // Clamp for polar day/night so the result stays usable.
  const ha = Math.acos(Math.min(1, Math.max(-1, cosHa))) / RAD
  const utcMidnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const minutes = (m: number) => new Date(utcMidnight + m * 60_000)
  return { sunrise: minutes(720 - 4 * (lon + ha) - eqTime), sunset: minutes(720 - 4 * (lon - ha) - eqTime) }
}

/**
 * A rough location when none is set: latitude 37°N (mid United States) and a
 * longitude from the computer's standard time zone, 15° per hour.
 */
export function guessLocation(now = new Date()): Location {
  const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset()
  const jul = new Date(now.getFullYear(), 6, 1).getTimezoneOffset()
  const standardOffsetMinutes = Math.max(jan, jul)
  return { lat: 37, lon: -(standardOffsetMinutes / 60) * 15 }
}

/** Which lighting phase a moment falls in, relative to that day's sunrise and sunset. */
export function phaseAt(now: Date, location: Location): Phase {
  const { sunrise, sunset } = sunTimes(now, location)
  const t = now.getTime()
  const min = 60_000
  if (t < sunrise.getTime() - 45 * min) return 'night'
  if (t < sunrise.getTime() + 90 * min) return 'dawn'
  if (t < sunset.getTime() - 120 * min) return 'day'
  if (t < sunset.getTime() + 20 * min) return 'golden'
  if (t < sunset.getTime() + 80 * min) return 'dusk'
  return 'night'
}

export const LIGHT_PHASES: Phase[] = ['dawn', 'day', 'golden']

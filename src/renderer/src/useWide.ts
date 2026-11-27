import { useSyncExternalStore } from 'react'

/**
 * True on very wide windows, such as a 5K2K ultrawide (5120×2160), which is
 * 2560–5120 CSS pixels wide depending on Windows' display scaling. Must match
 * the breakpoint in styles.css.
 */
const WIDE = '(min-width: 2200px)'

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(WIDE)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

export function useWide(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches)
}

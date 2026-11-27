import type { AreteApi } from '../shared/types'

declare global {
  interface Window {
    arete: AreteApi
  }
}

export {}

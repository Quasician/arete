import { create } from 'zustand'

export type Page = 'week' | 'activity' | 'food' | 'weight' | 'settings'

interface UiState {
  page: Page
  setPage: (page: Page) => void
}

export const useUi = create<UiState>((set) => ({
  page: 'week',
  setPage: (page) => set({ page })
}))

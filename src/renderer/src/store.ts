import { create } from 'zustand'

export type Page = 'week' | 'habits' | 'activity' | 'food' | 'weight' | 'progress' | 'goals' | 'settings'

interface UiState {
  page: Page
  setPage: (page: Page) => void
}

export const useUi = create<UiState>((set) => ({
  page: 'week',
  setPage: (page) => set({ page })
}))

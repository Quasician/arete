import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SettingsPatch, UpdateStatus } from '@shared/types'

export const api = window.arete

export const keys = {
  settings: ['settings'] as const,
  week: (start: string) => ['week', start] as const,
  activities: (from: string, to: string) => ['activities', from, to] as const,
  weights: (from: string, to: string) => ['weights', from, to] as const,
  meals: (date: string) => ['meals', date] as const
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api.getSettings() })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.updateSettings(patch),
    onSuccess: (settings) => {
      qc.setQueryData(keys.settings, settings)
      void qc.invalidateQueries({ queryKey: ['week'] })
    }
  })
}

/** Refresh everything that depends on synced data whenever a sync finishes. */
export function useSyncRefresh() {
  const qc = useQueryClient()
  useEffect(
    () =>
      api.onSynced(() => {
        void qc.invalidateQueries()
      }),
    [qc]
  )
}

/** Invalidate the lists that a change to activities, weights or meals affects. */
export function useInvalidate() {
  const qc = useQueryClient()
  return (...prefixes: string[]) => {
    for (const p of prefixes) void qc.invalidateQueries({ queryKey: [p] })
  }
}

export function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // Electron prefixes errors thrown in the main process; show only the message.
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Live update status from the main process. */
export function useUpdateStatus(): UpdateStatus | undefined {
  const [status, setStatus] = useState<UpdateStatus>()
  useEffect(() => {
    let alive = true
    void api.getUpdateStatus().then((s) => alive && setStatus(s))
    const off = api.onUpdateStatus(setStatus)
    return () => {
      alive = false
      off()
    }
  }, [])
  return status
}

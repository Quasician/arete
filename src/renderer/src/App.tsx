import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, errorText, useSettings, useSyncRefresh, useUpdateStatus } from './api'
import { useUi, type Page } from './store'
import { timeAgo } from './format'
import { WeekPage } from './pages/WeekPage'
import { ActivityPage } from './pages/ActivityPage'
import { FoodPage } from './pages/FoodPage'
import { WeightPage } from './pages/WeightPage'
import { SettingsPage } from './pages/SettingsPage'
import { ProgressPage } from './pages/ProgressPage'
import icon from './assets/icon.png'
import { useThemeController } from './theme'

const NAV: { page: Page; label: string }[] = [
  { page: 'week', label: 'Week' },
  { page: 'activity', label: 'Activity' },
  { page: 'food', label: 'Food' },
  { page: 'weight', label: 'Weight' },
  { page: 'progress', label: 'Progress' },
  { page: 'settings', label: 'Settings' }
]

export function App() {
  const { page, setPage } = useUi()
  const settings = useSettings().data
  useSyncRefresh()
  useThemeController(settings)

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src={icon} alt="" />
          <span>Arete</span>
        </div>
        <nav>
          {NAV.map((item) => (
            <button
              key={item.page}
              className={item.page === page ? 'nav-item active' : 'nav-item'}
              onClick={() => setPage(item.page)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <SyncPanel />
      </aside>
      <main className="content">
        {page === 'week' && <WeekPage />}
        {page === 'activity' && <ActivityPage />}
        {page === 'food' && <FoodPage />}
        {page === 'weight' && <WeightPage />}
        {page === 'progress' && <ProgressPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}

function SyncPanel() {
  const settings = useSettings().data
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const version = useQuery({ queryKey: ['appInfo'], queryFn: () => api.appInfo() }).data?.version

  const hasKeys = settings && Object.values(settings.secrets).some(Boolean)
  const statuses = settings ? Object.entries(settings.lastSync) : []

  async function syncNow() {
    setBusy(true)
    setError(null)
    try {
      await api.syncNow()
      await qc.invalidateQueries()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sync-panel">
      {hasKeys ? (
        <>
          <button className="button small" onClick={syncNow} disabled={busy}>
            {busy ? 'Syncing…' : 'Sync now'}
          </button>
          {statuses.map(([source, s]) => (
            <div key={source} className={s.ok ? 'sync-line' : 'sync-line bad'} title={s.message}>
              {source === 'hevy' ? 'Hevy' : 'Concept2'}: {s.ok ? timeAgo(s.at) : 'needs attention'}
            </div>
          ))}
        </>
      ) : (
        <div className="sync-line">Add your Hevy and Concept2 keys in Settings to import workouts.</div>
      )}
      {error && <div className="sync-line bad">{error}</div>}
      <UpdateNotice />
      {version && <div className="version">v{version}</div>}
    </div>
  )
}

function UpdateNotice() {
  const status = useUpdateStatus()
  if (status?.state === 'downloading') return <div className="sync-line">Downloading update {status.version}…</div>
  if (status?.state !== 'ready') return null
  return (
    <div className="update-ready">
      <div>Version {status.version} is ready.</div>
      <button className="button small" onClick={() => api.installUpdate()}>
        Restart to update
      </button>
    </div>
  )
}

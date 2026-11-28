import { useEffect, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toLocalDate } from '@shared/logic'
import {
  ACTIVITY_KINDS,
  KIND_LABELS,
  type ActivityKind,
  type AgeGroup,
  type PublicSettings,
  type RowingTrainingLevel,
  type ThemeMode,
  type TypicalMinutes,
  type UpdateStatus,
  type SecretName,
  type SyncStatus,
  type TrainingProgram,
  type WeeklyPlan
} from '@shared/types'
import { api, errorText, keys, useSettings, useUpdateSettings, useUpdateStatus } from '../api'
import { timeAgo } from '../format'
import { guessLocation, sunTimes } from '@shared/sun'
import { useTheme, type ThemeName } from '../theme'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const KEY_HELP: Record<SecretName, { label: string; help: string; url: string }> = {
  hevy: {
    label: 'Hevy API key',
    help: 'Imports your lifting workouts. Needs Hevy Pro; create the key in Hevy’s web app under Settings → Developer.',
    url: 'https://hevy.com/settings?developer'
  },
  todoist: {
    label: 'Todoist API token',
    help: "Puts each day's habits on your Todoist list, so Praxis shows them, and logs a habit when you tick its task. It's the same token Praxis uses: Todoist → Settings → Integrations → Developer.",
    url: 'https://app.todoist.com/app/settings/integrations/developer'
  },
  anthropic: {
    label: 'Anthropic API key',
    help: 'Estimates calories and protein from meal descriptions on the Food page (a fraction of a cent per meal). Create one at console.anthropic.com under API keys.',
    url: 'https://console.anthropic.com/settings/keys'
  },
  concept2: {
    label: 'Concept2 Logbook token',
    help: 'Imports your rowing sessions. Generate it on log.concept2.com under Edit Profile → Applications.',
    url: 'https://log.concept2.com/'
  }
}

export function SettingsPage() {
  const settings = useSettings()
  if (!settings.data) return <div className="page">{settings.error && errorText(settings.error)}</div>
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="subtle">Everything here stays on this PC. Keys are encrypted with Windows’ own protection.</p>
        </div>
      </header>
      <div className="two-col">
        <div className="col">
          <KeysCard settings={settings.data} />
          <ProgramCard program={settings.data.program} />
          <FitnessCard settings={settings.data} />
          <LightingCard settings={settings.data} />
          <AppCard settings={settings.data} />
        </div>
        <div className="col">
          <PlanCard plan={settings.data.plan} />
          <TypicalMinutesCard settings={settings.data} />
        </div>
      </div>
    </div>
  )
}

function KeysCard({ settings }: { settings: PublicSettings }) {
  return (
    <section className="card">
      <h2>Connections</h2>
      {!settings.canEncrypt && (
        <p className="error">Windows encryption isn’t available, so keys can’t be saved safely right now.</p>
      )}
      {(Object.keys(KEY_HELP) as SecretName[]).map((name) => (
        <KeyRow
          key={name}
          name={name}
          saved={settings.secrets[name]}
          status={name === 'anthropic' ? undefined : settings.lastSync[name]}
        />
      ))}
    </section>
  )
}

function KeyRow({
  name,
  saved,
  status
}: {
  name: SecretName
  saved: boolean
  status?: SyncStatus
}) {
  const qc = useQueryClient()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const info = KEY_HELP[name]

  async function save(next: string | null) {
    setError(null)
    try {
      const updated = await api.setSecret(name, next)
      qc.setQueryData(keys.settings, updated)
      setValue('')
      if (next && name !== 'anthropic' && name !== 'todoist') void api.syncNow().then(() => qc.invalidateQueries())
    } catch (err) {
      setError(errorText(err))
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (value.trim()) void save(value)
  }

  return (
    <div className="key-row">
      <div className="key-info">
        <strong>{info.label}</strong>
        <span className={saved ? 'pill ok' : 'pill'}>{saved ? 'Saved' : 'Not set'}</span>
        <p className="subtle small">
          {info.help}{' '}
          <a href={info.url} target="_blank" rel="noreferrer">
            Open
          </a>
        </p>
        {status && (
          <p className={status.ok ? 'subtle small' : 'error small'}>
            Last sync {timeAgo(status.at)}: {status.message}
          </p>
        )}
      </div>
      <form className="form-row tight" onSubmit={submit}>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={saved ? 'Paste a new key to replace it' : 'Paste key'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="button small" type="submit" disabled={!value.trim()}>
          Save
        </button>
        {saved && (
          <button className="button small ghost" type="button" onClick={() => save(null)}>
            Remove
          </button>
        )}
      </form>
      {error && <p className="error small">{error}</p>}
    </div>
  )
}

function PlanCard({ plan }: { plan: WeeklyPlan }) {
  const update = useUpdateSettings()
  const [draft, setDraft] = useState<WeeklyPlan>(plan)
  useEffect(() => setDraft(plan), [plan])
  const dirty = JSON.stringify(draft) !== JSON.stringify(plan)

  function toggle(day: number, kind: ActivityKind) {
    setDraft((d) => d.map((kinds, i) => (i !== day ? kinds : kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind])))
  }

  return (
    <section className="card">
      <h2>Weekly plan</h2>
      <p className="subtle small">What you plan to do on each day. The Week page compares this against what actually happened.</p>
      <table className="plan-table">
        <thead>
          <tr>
            <th />
            {ACTIVITY_KINDS.map((k) => (
              <th key={k}>{KIND_LABELS[k]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day, i) => (
            <tr key={day}>
              <td>{day}</td>
              {ACTIVITY_KINDS.map((k) => (
                <td key={k}>
                  <input
                    type="checkbox"
                    aria-label={`${KIND_LABELS[k]} on ${day}`}
                    checked={draft[i].includes(k)}
                    onChange={() => toggle(i, k)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <button className="button" disabled={!dirty || update.isPending} onClick={() => update.mutate({ plan: draft })}>
          Save plan
        </button>
        {dirty && (
          <button className="button ghost" onClick={() => setDraft(plan)}>
            Discard changes
          </button>
        )}
      </div>
      {update.error && <p className="error small">{errorText(update.error)}</p>}
    </section>
  )
}

function ProgramCard({ program }: { program: TrainingProgram | null }) {
  const update = useUpdateSettings()
  const [name, setName] = useState(program?.name ?? '')
  const [start, setStart] = useState(program?.start ?? toLocalDate(new Date()))
  const [weeks, setWeeks] = useState(String(program?.weeks ?? 12))
  const [kind, setKind] = useState<ActivityKind>(program?.kind ?? 'row')

  function submit(e: FormEvent) {
    e.preventDefault()
    update.mutate({ program: { name: name.trim() || 'Program', start, weeks: Number(weeks), kind } })
  }

  return (
    <section className="card">
      <h2>Training program</h2>
      <p className="subtle small">A program with a start date and length, shown on the Week page as “week N of M”.</p>
      <form className="form-row" onSubmit={submit}>
        <label className="grow">
          Name
          <input value={name} maxLength={80} placeholder="e.g. Rowing HIIT + Zone 2" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Starts
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label>
          Weeks
          <input type="number" min="1" max="104" value={weeks} onChange={(e) => setWeeks(e.target.value)} required />
        </label>
        <label>
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value as ActivityKind)}>
            {ACTIVITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <button className="button" type="submit" disabled={update.isPending}>
          Save program
        </button>
        {program && (
          <button className="button ghost" type="button" onClick={() => update.mutate({ program: null })}>
            Clear
          </button>
        )}
      </form>
      {update.error && <p className="error small">{errorText(update.error)}</p>}
    </section>
  )
}

function FitnessCard({ settings }: { settings: PublicSettings }) {
  const update = useUpdateSettings()
  return (
    <section className="card">
      <h2>Units and comparisons</h2>
      <div className="settings-grid">
        <span>Weight units</span>
        <div className="segmented">
          {(['lb', 'kg'] as const).map((u) => (
            <button key={u} className={settings.units === u ? 'active' : ''} onClick={() => update.mutate({ units: u })}>
              {u === 'lb' ? 'Pounds' : 'Kilograms'}
            </button>
          ))}
        </div>
        <span>VO2max reference group</span>
        <div className="segmented">
          {(['20-29', '30-39'] as AgeGroup[]).map((g) => (
            <button key={g} className={settings.ageGroup === g ? 'active' : ''} onClick={() => update.mutate({ ageGroup: g })}>
              Men {g}
            </button>
          ))}
        </div>
        <span>Rowing training level</span>
        <div>
          <div className="segmented">
            {(['low', 'high'] as RowingTrainingLevel[]).map((l) => (
              <button key={l} className={settings.rowingLevel === l ? 'active' : ''} onClick={() => update.mutate({ rowingLevel: l })}>
                {l === 'low' ? 'Not highly trained' : 'Highly trained'}
              </button>
            ))}
          </div>
          <p className="subtle small">
            Concept2 counts as highly trained someone who has rowed at least four days a week for several years. It
            changes the VO2max formula.
          </p>
        </div>
      </div>
      {update.error && <p className="error small">{errorText(update.error)}</p>}
    </section>
  )
}

function TypicalMinutesCard({ settings }: { settings: PublicSettings }) {
  const update = useUpdateSettings()
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(ACTIVITY_KINDS.map((k) => [k, settings.typicalMinutes[k] ? String(settings.typicalMinutes[k]) : '']))
  )
  const parsed: TypicalMinutes = {}
  for (const k of ACTIVITY_KINDS) {
    const n = Number(draft[k])
    if (draft[k] && Number.isInteger(n) && n > 0 && n <= 1440) parsed[k] = n
  }
  const dirty = JSON.stringify(parsed) !== JSON.stringify(settings.typicalMinutes)
  return (
    <section className="card">
      <h2>Typical session length</h2>
      <p className="subtle small">
        Used for sessions logged without a duration, such as one-click check-ins, so they count toward weekly active
        minutes. Leave blank to not count them.
      </p>
      <div className="minutes-grid">
        {ACTIVITY_KINDS.map((k) => (
          <label key={k}>
            {KIND_LABELS[k]}
            <input
              type="number"
              min="1"
              max="1440"
              placeholder="min"
              value={draft[k]}
              onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <button className="button" disabled={!dirty || update.isPending} onClick={() => update.mutate({ typicalMinutes: parsed })}>
        Save lengths
      </button>
      {update.error && <p className="error small">{errorText(update.error)}</p>}
    </section>
  )
}

function LightingCard({ settings }: { settings: PublicSettings }) {
  const update = useUpdateSettings()
  const theme = useTheme((t) => t.name)
  const [lat, setLat] = useState(settings.sunLocation ? String(settings.sunLocation.lat) : '')
  const [lon, setLon] = useState(settings.sunLocation ? String(settings.sunLocation.lon) : '')
  const loc = settings.sunLocation ?? guessLocation()
  const { sunrise, sunset } = sunTimes(new Date(), loc)
  const time = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  function saveLocation(e: FormEvent) {
    e.preventDefault()
    const la = Number(lat)
    const lo = Number(lon)
    if (lat.trim() === '' && lon.trim() === '') update.mutate({ sunLocation: null })
    else if (isFinite(la) && isFinite(lo)) update.mutate({ sunLocation: { lat: la, lon: lo } })
  }

  return (
    <section className="card">
      <h2>Lighting</h2>
      <div className="segmented">
        {(
          [
            ['auto', 'Follow the time of day'],
            ['light', 'Always light'],
            ['dark', 'Always dark']
          ] as [ThemeMode, string][]
        ).map(([m, label]) => (
          <button key={m} className={settings.themeMode === m ? 'active' : ''} onClick={() => update.mutate({ themeMode: m })}>
            {label}
          </button>
        ))}
      </div>
      <p className="subtle small">
        Now: {THEME_LABELS[theme]}. Light from about 45 minutes before sunrise, warm in the two hours before sunset, then
        dusk and night colours. Today's sunrise is {time(sunrise)} and sunset {time(sunset)}
        {settings.sunLocation ? '.' : ', estimated from your time zone; set your location for exact times.'}
      </p>
      <form className="form-row tight" onSubmit={saveLocation}>
        <input className="narrow" placeholder="Latitude" value={lat} onChange={(e) => setLat(e.target.value)} />
        <input className="narrow" placeholder="Longitude" value={lon} onChange={(e) => setLon(e.target.value)} />
        <button className="button small ghost" type="submit">
          Save location
        </button>
      </form>
      <p className="subtle small">Only used to work out sunrise and sunset; it stays on this PC. Example: 37.43, -121.90.</p>
      {update.error && <p className="error small">{errorText(update.error)}</p>}
    </section>
  )
}

const THEME_LABELS: Record<ThemeName, string> = {
  dawn: 'dawn',
  day: 'daylight',
  golden: 'golden hour',
  dusk: 'dusk',
  night: 'night'
}

function AppCard({ settings }: { settings: PublicSettings }) {
  const update = useUpdateSettings()
  const info = useQuery({ queryKey: ['appInfo'], queryFn: () => api.appInfo() }).data
  const status = useUpdateStatus()
  const [checking, setChecking] = useState(false)

  async function check() {
    setChecking(true)
    try {
      await api.checkForUpdates()
    } finally {
      setChecking(false)
    }
  }

  return (
    <section className="card">
      <h2>App</h2>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.openAtLogin}
          onChange={(e) => update.mutate({ openAtLogin: e.target.checked })}
        />
        Open Arete when Windows starts
      </label>
      <div className="update-row">
        <span>Version {info?.version ?? ''}</span>
        <span className="subtle small">{describeUpdate(status)}</span>
        {status?.state === 'ready' ? (
          <button className="button small" onClick={() => api.installUpdate()}>
            Restart to update
          </button>
        ) : (
          <button
            className="button small ghost"
            onClick={check}
            disabled={checking || status?.state === 'checking' || status?.state === 'downloading' || status?.state === 'unavailable'}
          >
            Check for updates
          </button>
        )}
      </div>
      {update.error && <p className="error small">{errorText(update.error)}</p>}
    </section>
  )
}

export function describeUpdate(status: UpdateStatus | undefined): string {
  switch (status?.state) {
    case 'checking':
      return 'Checking for updates…'
    case 'downloading':
      return `Downloading ${status.version} (${status.percent}%)…`
    case 'ready':
      return `Version ${status.version} is ready to install.`
    case 'latest':
      return `Up to date (checked ${timeAgo(status.checkedAt)}).`
    case 'error':
      return `Couldn't check for updates: ${status.message}`
    case 'unavailable':
      return 'Updates only apply to the installed app.'
    default:
      return 'Checks automatically at start-up and every six hours.'
  }
}

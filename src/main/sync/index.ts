// Pulls workouts from Hevy (lifting) and the Concept2 Logbook (rowing).
import type { Repo } from '../repo.ts'
import type { Settings } from '../settings.ts'
import type { SyncReport, SyncSource, SyncStatus } from '../../shared/types.ts'
import { addDays } from '../../shared/logic.ts'
import { mapConcept2Result, mapHevyWorkout, type Concept2Result, type HevyWorkout } from './map.ts'

const MAX_PAGES = 200
const TIMEOUT_MS = 20_000

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

async function getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`)
  return (await res.json()) as T
}

function describeError(err: unknown, service: string): string {
  if (err instanceof HttpError) {
    if (err.status === 401 || err.status === 403) return `${service} rejected the key. Check it in Settings.`
    if (err.status === 429) return `${service} asked us to slow down. Arete will try again later.`
    return `${service} returned an error (${err.status}).`
  }
  if (err instanceof Error && err.name === 'TimeoutError') return `${service} didn't respond in time.`
  return `Couldn't reach ${service}. Check your internet connection.`
}

interface HevyPage {
  page: number
  page_count: number
  workouts: HevyWorkout[]
}

export async function syncHevy(apiKey: string, repo: Repo): Promise<string> {
  const incremental = repo.latestActivityDate('hevy') !== null
  let added = 0
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await getJson<HevyPage>(`https://api.hevyapp.com/v1/workouts?page=${page}&pageSize=10`, {
      'api-key': apiKey,
      accept: 'application/json'
    })
    const workouts = data.workouts ?? []
    let allKnown = workouts.length > 0
    for (const w of workouts) {
      const row = mapHevyWorkout(w)
      if (!row) continue
      if (!repo.hasActivity('hevy', row.externalId)) allKnown = false
      if (repo.upsertSynced(row)) added++
    }
    // Newest workouts come first, so once a whole page is already known we've caught up.
    if (incremental && allKnown) break
    if (page >= (data.page_count ?? 0) || workouts.length === 0) break
  }
  return added === 1 ? '1 new workout' : `${added} new workouts`
}

interface Concept2Page {
  data: Concept2Result[]
  meta?: { pagination?: { links?: { next?: string } } }
}

export async function syncConcept2(token: string, repo: Repo): Promise<string> {
  const latest = repo.latestActivityDate('concept2')
  const params = new URLSearchParams()
  // Re-read the last two weeks so edits made in the logbook come through.
  if (latest) params.set('from', addDays(latest, -14))
  let url: string | undefined = `https://log.concept2.com/api/users/me/results?${params}`
  let added = 0
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const data: Concept2Page = await getJson<Concept2Page>(url, {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.c2logbook.v1+json'
    })
    for (const r of data.data ?? []) {
      const row = mapConcept2Result(r)
      if (row && repo.upsertSynced(row)) added++
    }
    const next = data.meta?.pagination?.links?.next
    url = next && next.startsWith('https://log.concept2.com/') ? next : undefined
  }
  return added === 1 ? '1 new session' : `${added} new sessions`
}

let running: Promise<SyncReport> | null = null

/** Sync every service that has a key saved. Concurrent calls share one run. */
export function syncAll(settings: Settings, repo: Repo): Promise<SyncReport> {
  if (running) return running
  running = (async () => {
    const results: Partial<Record<SyncSource, SyncStatus>> = {}
    const jobs: [SyncSource, string, (key: string) => Promise<string>][] = [
      ['hevy', 'Hevy', (key) => syncHevy(key, repo)],
      ['concept2', 'Concept2', (key) => syncConcept2(key, repo)]
    ]
    for (const [source, label, run] of jobs) {
      const key = settings.getSecret(source)
      if (!key) continue
      let status: SyncStatus
      try {
        status = { at: new Date().toISOString(), ok: true, message: await run(key) }
      } catch (err) {
        status = { at: new Date().toISOString(), ok: false, message: describeError(err, label) }
      }
      settings.recordSync(source, status)
      results[source] = status
    }
    return { results }
  })().finally(() => {
    running = null
  })
  return running
}

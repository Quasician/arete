// A small Todoist API v1 client: just what Arete needs to put habits and the
// weekly review on your Todoist list, where Praxis picks them up.

/** Overridable for tests, like Praxis's TODOIST_BASE. */
const BASE = process.env['ARETE_TODOIST_BASE'] || 'https://api.todoist.com/api/v1'
const TIMEOUT_MS = 20_000

export class TodoistError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export interface TodoistTask {
  id: string
  content: string
  checked?: boolean
  is_deleted?: boolean
  completed_at?: string
}

export class Todoist {
  constructor(private readonly token: string) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) {
      const message =
        res.status === 401 || res.status === 403
          ? 'Todoist rejected the token. Check it in Settings.'
          : `Todoist returned an error (${res.status}).`
      throw new TodoistError(res.status, message)
    }
    const text = await res.text()
    return (text ? JSON.parse(text) : null) as T
  }

  /** Follows next_cursor pages. */
  private async all<T>(path: string): Promise<T[]> {
    const out: T[] = []
    let cursor: string | null = null
    for (let page = 0; page < 50; page++) {
      const sep = path.includes('?') ? '&' : '?'
      const data: unknown = await this.request('GET', `${path}${sep}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      if (Array.isArray(data)) return [...out, ...data]
      const p = data as { results?: T[]; items?: T[]; next_cursor?: string | null }
      out.push(...(p.results ?? p.items ?? []))
      cursor = p.next_cursor ?? null
      if (!cursor) break
    }
    return out
  }

  async projectId(name: string): Promise<string> {
    const projects = await this.all<{ id: string; name: string; is_deleted?: boolean; is_archived?: boolean }>('/projects')
    const found = projects.find((p) => p.name === name && !p.is_deleted && !p.is_archived)
    if (found) return found.id
    const created = await this.request<{ id: string }>('POST', '/projects', { name })
    return created.id
  }

  createTask(task: {
    content: string
    description?: string
    projectId: string
    dueString: string
    durationMinutes?: number
  }): Promise<TodoistTask> {
    return this.request<TodoistTask>('POST', '/tasks', {
      content: task.content,
      description: task.description ?? '',
      project_id: task.projectId,
      due_string: task.dueString,
      ...(task.durationMinutes ? { duration: task.durationMinutes, duration_unit: 'minute' } : {})
    })
  }

  async closeTask(id: string): Promise<void> {
    await this.request('POST', `/tasks/${encodeURIComponent(id)}/close`)
  }

  async deleteTask(id: string): Promise<void> {
    try {
      await this.request('DELETE', `/tasks/${encodeURIComponent(id)}`)
    } catch (err) {
      if (!(err instanceof TodoistError && err.status === 404)) throw err
    }
  }

  /** Ids of tasks completed between two moments. */
  async completedIds(since: Date, until: Date): Promise<Set<string>> {
    const tasks = await this.all<TodoistTask & { task_id?: string }>(
      `/tasks/completed/by_completion_date?since=${encodeURIComponent(since.toISOString())}&until=${encodeURIComponent(until.toISOString())}`
    )
    return new Set(tasks.map((t) => String(t.task_id ?? t.id)))
  }
}

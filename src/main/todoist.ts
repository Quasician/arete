// A small Todoist API v1 client: just what Arete needs to read @habit tasks,
// tick them off, and put the weekly review on your list, where Praxis picks it up.
import type { TodoistHabitTask } from '../shared/todoistHabits.ts'

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
  private async all<T>(path: string, limit = 200): Promise<T[]> {
    const out: T[] = []
    let cursor: string | null = null
    for (let page = 0; page < 50; page++) {
      const sep = path.includes('?') ? '&' : '?'
      const data: unknown = await this.request('GET', `${path}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      if (Array.isArray(data)) return [...out, ...data]
      const p = data as { results?: T[]; items?: T[]; next_cursor?: string | null }
      out.push(...(p.results ?? p.items ?? []))
      cursor = p.next_cursor ?? null
      if (!cursor) break
    }
    return out
  }

  /** Open tasks labelled @habit. */
  habitTasks(): Promise<TodoistHabitTask[]> {
    return this.all<TodoistHabitTask & { checked?: boolean; is_deleted?: boolean }>(
      `/tasks/filter?query=${encodeURIComponent('@habit')}`
    ).then((ts) => ts.filter((t) => !t.checked && !t.is_deleted))
  }

  /**
   * Every completion since a moment, recurring tasks included: Todoist's
   * completed list leaves those out, but its activity log has each tick.
   */
  async completions(since: Date): Promise<{ taskId: string; at: string }[]> {
    const events = await this.all<{ object_id?: string; event_date?: string }>(
      `/activities?object_type=item&event_type=completed&date_from=${encodeURIComponent(since.toISOString())}`,
      100
    )
    return events
      .filter((e) => e.object_id && e.event_date)
      .map((e) => ({ taskId: String(e.object_id), at: e.event_date! }))
  }

  createTask(task: {
    content: string
    description?: string
    dueString: string
    durationMinutes?: number
    labels?: string[]
  }): Promise<TodoistTask> {
    return this.request<TodoistTask>('POST', '/tasks', {
      content: task.content,
      description: task.description ?? '',
      due_string: task.dueString,
      ...(task.labels ? { labels: task.labels } : {}),
      ...(task.durationMinutes ? { duration: task.durationMinutes, duration_unit: 'minute' } : {})
    })
  }

  async updateTask(id: string, patch: { dueString?: string; durationMinutes?: number }): Promise<void> {
    await this.request('POST', `/tasks/${encodeURIComponent(id)}`, {
      ...(patch.dueString ? { due_string: patch.dueString } : {}),
      ...(patch.durationMinutes ? { duration: patch.durationMinutes, duration_unit: 'minute' } : {})
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
}

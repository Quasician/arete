// A small log in Arete's data folder (arete.log), like Praxis's praxis.log, for
// working out what went wrong later. It records what happened and when, never
// keys, tokens, meal descriptions, weights or notes.
import fs from 'node:fs'
import path from 'node:path'

const MAX_BYTES = 1_000_000
let file: string | null = null

export function initLog(dir: string): void {
  file = path.join(dir, 'arete.log')
  try {
    fs.mkdirSync(dir, { recursive: true })
    // Keep one older file once this one passes 1 MB.
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`)
  } catch {
    // Logging must never stop Arete.
  }
}

function text(a: unknown): string {
  if (a instanceof Error) return a.stack ? a.stack.split('\n').slice(0, 4).join(' | ') : a.message
  if (typeof a === 'string') return a
  try {
    return JSON.stringify(a)
  } catch {
    return String(a)
  }
}

/** Removes anything that looks like a key or token, just in case. */
export function scrub(s: string): string {
  return s
    .replace(/bearer\s+[^\s"',}]+/gi, 'Bearer [hidden]')
    .replace(/(api[-_ ]?key|token|authorization)(["':=\s]+)(?!Bearer \[hidden\])[^\s"',}]+/gi, '$1$2[hidden]')
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[hidden]')
}

export function log(...parts: unknown[]): void {
  if (!file) return
  try {
    fs.appendFileSync(file, `${new Date().toISOString()} ${scrub(parts.map(text).join(' '))}\n`)
  } catch {
    // Logging must never stop Arete.
  }
}

/** The last lines of the log, newest last. */
export function logTail(lines = 200): string[] {
  if (!file) return []
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-lines)
  } catch {
    return []
  }
}

/** Runs a step and logs how it went and how long it took. */
export async function logged<T>(what: string, run: () => Promise<T>, describe?: (r: T) => string): Promise<T> {
  const t0 = Date.now()
  try {
    const r = await run()
    log(what, 'ok', `${Date.now() - t0}ms`, describe ? describe(r) : '')
    return r
  } catch (err) {
    log(what, 'FAILED', `${Date.now() - t0}ms`, err)
    throw err
  }
}

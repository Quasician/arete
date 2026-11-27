// SQLite through sql.js (WebAssembly), so there is no native module to build.
// The whole database lives in memory and is saved to one file after each change.
import fs from 'node:fs'
import path from 'node:path'
import initSqlJs, { type Database } from 'sql.js'
import { drizzle, type SQLJsDatabase } from 'drizzle-orm/sql-js'
import { MIGRATIONS } from './schema.ts'

export class Store {
  readonly orm: SQLJsDatabase
  private saveTimer: NodeJS.Timeout | null = null

  private constructor(
    private readonly raw: Database,
    private readonly file: string
  ) {
    this.orm = drizzle(raw)
  }

  /** wasmFile is the path to sql.js's sql-wasm.wasm. */
  static async open(file: string, wasmFile: string): Promise<Store> {
    const wasm = fs.readFileSync(wasmFile)
    const wasmBinary = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer
    const SQL = await initSqlJs({ wasmBinary })
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const existing = fs.existsSync(file) ? fs.readFileSync(file) : null
    const raw = existing ? new SQL.Database(existing) : new SQL.Database()
    const store = new Store(raw, file)
    store.migrate()
    return store
  }

  private migrate(): void {
    const version = Number(this.raw.exec('PRAGMA user_version')[0]?.values[0]?.[0] ?? 0)
    if (version > MIGRATIONS.length) {
      throw new Error(
        `This database was created by a newer version of Arete (schema ${version}). Update Arete to open it.`
      )
    }
    if (version === MIGRATIONS.length) return
    // Keep a copy of the file as it was before upgrading.
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.v${version}.bak`)
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.raw.exec('BEGIN')
      try {
        this.raw.exec(MIGRATIONS[v])
        this.raw.exec(`PRAGMA user_version = ${v + 1}`)
        this.raw.exec('COMMIT')
      } catch (err) {
        this.raw.exec('ROLLBACK')
        throw err
      }
    }
    this.saveNow()
  }

  /** Call after any write. Saves shortly after, batching bursts of writes. */
  changed(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.saveNow()
    }, 300)
  }

  /** Write the database to disk via a temporary file, so a crash can't leave a half-written file. */
  saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, Buffer.from(this.raw.export()))
    fs.renameSync(tmp, this.file)
  }

  close(): void {
    this.saveNow()
    this.raw.close()
  }
}

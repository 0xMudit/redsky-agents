import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Crash-safe JSON write: temp file then rename (copy+unlink fallback on Windows).
 *
 * All I/O errors are caught and rethrown with context so callers can decide whether
 * to surface them — a disk-full or permission error must never silently corrupt state.
 */
export function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  const payload = `${JSON.stringify(value, null, 2)}\n`
  try {
    fs.writeFileSync(tmp, payload, { encoding: 'utf8', flag: 'w' })
  } catch (err) {
    // Clean up the temp file if it was partially created, then surface the error.
    try { fs.unlinkSync(tmp) } catch { /* already gone */ }
    throw new Error(`red-sky: failed to write ${path.basename(file)}: ${(err as Error).message}`)
  }
  try {
    fs.renameSync(tmp, file)
  } catch {
    // Windows: renameSync may fail if destination is locked; fall back to copy+unlink.
    try {
      fs.copyFileSync(tmp, file)
      fs.unlinkSync(tmp)
    } catch (err) {
      try { fs.unlinkSync(tmp) } catch { /* already gone */ }
      throw new Error(`red-sky: failed to commit ${path.basename(file)}: ${(err as Error).message}`)
    }
  }
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * JsonStore with:
 *  - In-memory cache: read() returns the cached value without hitting disk every time.
 *  - Debounced writes: write() schedules a flush after `debounceMs` (default 200 ms),
 *    coalescing rapid successive writes into a single disk write.
 *  - flush(): immediate synchronous flush used on app quit / before-quit.
 */
export class JsonStore<T> {
  private cache: T | undefined
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly debounceMs: number

  constructor(
    private readonly file: string,
    private readonly fallback: T,
    opts: { debounceMs?: number } = {},
  ) {
    this.debounceMs = opts.debounceMs ?? 200
  }

  read(): T {
    if (this.cache !== undefined) return this.cache
    this.cache = readJson(this.file, this.fallback)
    return this.cache
  }

  write(value: T): void {
    this.cache = value
    this.dirty = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.dirty) this._flush()
    }, this.debounceMs)
  }

  /** Force an immediate synchronous write. Call on app.before-quit. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.dirty) this._flush()
  }

  private _flush(): void {
    if (this.cache === undefined) return
    try {
      writeJsonAtomic(this.file, this.cache)
      this.dirty = false
    } catch (err) {
      // Log but don't throw — we're in a background timer; the in-memory cache is still live.
      console.error('[red-sky persist] flush failed:', (err as Error).message)
    }
  }
}

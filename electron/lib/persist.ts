import * as fs from 'node:fs'
import * as path from 'node:path'

/** Crash-safe JSON write: temp file then rename (copy+unlink fallback on Windows).
 *  All I/O errors are caught and rethrown with context so callers can decide whether
 *  to surface them — a disk-full or permission error must never silently corrupt state. */
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

export class JsonStore<T> {
  constructor(
    private readonly file: string,
    private readonly fallback: T,
  ) {}

  read(): T {
    return readJson(this.file, this.fallback)
  }

  write(value: T): void {
    writeJsonAtomic(this.file, value)
  }
}

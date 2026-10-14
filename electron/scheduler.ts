import * as path from 'node:path'
import { JsonStore } from './lib/persist'
import { newId } from './lib/ids'
import { userDataDir } from './paths'
import type { Routine } from '../shared/types'

export type CronRow = Routine

/** setTimeout stores its delay in a signed 32-bit int; longer waits must be chunked. */
const MAX_TIMEOUT = 2_147_483_647

/** One-off schedules fire once at a fixed date/time, then disable themselves. */
export function isOneOff(schedule: string): boolean {
  return /^once\s+/i.test(schedule.trim())
}

export interface SchedulerHandle {
  rows: () => CronRow[]
  add: (botId: string, schedule: string, prompt: string, origin?: Routine['origin']) => CronRow
  remove: (id: string) => void
  removeReminders: (botId: string) => number
  setEnabled: (id: string, enabled: boolean) => void
  stop: () => void
}

export function nextDelayMs(schedule: string, from = Date.now()): number | null {
  const s = schedule.trim().toLowerCase()
  const every = s.match(/^every\s+(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/)
  if (every) {
    const n = Number(every[1])
    if (!Number.isFinite(n) || n <= 0) return null
    const unit = every[2]
    const ms = unit.startsWith('h') ? n * 3600_000 : n * 60_000
    return Math.max(5_000, ms)
  }
  const daily = s.match(/^(?:daily\s+)?(\d{1,2}):(\d{2})$/)
  if (daily) {
    const h = Number(daily[1])
    const m = Number(daily[2])
    if (h > 23 || m > 59) return null
    const d = new Date(from)
    d.setSeconds(0, 0)
    d.setHours(h, m, 0, 0)
    if (d.getTime() <= from) d.setDate(d.getDate() + 1)
    return d.getTime() - from
  }
  const once = s.match(/^once\s+(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2}))?$/)
  if (once) {
    const year = Number(once[1])
    const month = Number(once[2])
    const day = Number(once[3])
    const hour = once[4] != null ? Number(once[4]) : 9
    const min = once[5] != null ? Number(once[5]) : 0
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || min > 59) return null
    const when = new Date(year, month - 1, day, hour, min, 0, 0)
    // A day that rolls over (e.g. Feb 30) is not a real date.
    if (when.getFullYear() !== year || when.getMonth() !== month - 1 || when.getDate() !== day) return null
    const delay = when.getTime() - from
    return delay > 0 ? delay : null
  }
  return null
}

export function createScheduler(onFire: (row: CronRow) => void | Promise<void>): SchedulerHandle {
  const db = new JsonStore<CronRow[]>(path.join(userDataDir(), 'routines.json'), [])
  let rows: CronRow[] = db.read()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const inFlight = new Set<string>()

  const persist = () => db.write(rows)

  function disarm(id: string) {
    const t = timers.get(id)
    if (t) clearTimeout(t)
    timers.delete(id)
  }

  function arm(row: CronRow) {
    disarm(row.id)
    if (!row.enabled) return
    const delay = nextDelayMs(row.schedule)
    if (delay == null) return
    // A one-off far in the future exceeds setTimeout's range; re-arm in chunks.
    const wait = Math.min(delay, MAX_TIMEOUT)
    timers.set(
      row.id,
      setTimeout(() => {
        const live = rows.find((r) => r.id === row.id)
        if (!live?.enabled) return
        // Long one-off: not at the target instant yet, come back later.
        if (wait < delay) {
          arm(live)
          return
        }
        if (inFlight.has(live.id)) {
          arm(live)
          return
        }
        live.lastRun = Date.now()
        persist()
        inFlight.add(live.id)
        Promise.resolve(onFire(live))
          .catch(() => undefined)
          .finally(() => {
            inFlight.delete(live.id)
            // A one-off is spent once it fires; everything else re-arms.
            if (isOneOff(live.schedule)) {
              live.enabled = false
              persist()
            } else {
              arm(live)
            }
          })
      }, wait),
    )
  }

  for (const row of rows) arm(row)

  return {
    rows: () => rows.map((r) => ({ ...r })),
    add(botId, schedule, prompt, origin = 'manual') {
      if (nextDelayMs(schedule) == null) throw new Error('unrecognized schedule — use `every 30 m`, `every 2 h`, `09:00`, or `once 2026-01-31 09:00`')
      if (origin === 'reminder') {
        const same = rows.filter((r) => r.botId === botId && r.origin === 'reminder' && r.prompt.toLowerCase() === prompt.trim().toLowerCase())
        for (const r of same) {
          disarm(r.id)
        }
        rows = rows.filter((r) => !same.some((x) => x.id === r.id))
      }
      const row: CronRow = {
        id: newId('job'),
        botId,
        schedule: schedule.trim(),
        prompt: prompt.trim(),
        enabled: true,
        origin,
      }
      rows.push(row)
      persist()
      arm(row)
      return row
    },
    remove(id) {
      disarm(id)
      rows = rows.filter((r) => r.id !== id)
      persist()
    },
    removeReminders(botId) {
      const hit = rows.filter((r) => r.botId === botId && r.origin === 'reminder')
      for (const r of hit) disarm(r.id)
      rows = rows.filter((r) => !(r.botId === botId && r.origin === 'reminder'))
      persist()
      return hit.length
    },
    setEnabled(id, enabled) {
      const row = rows.find((r) => r.id === id)
      if (!row) return
      row.enabled = enabled
      persist()
      arm(row)
    },
    stop() {
      for (const id of timers.keys()) disarm(id)
    },
  }
}

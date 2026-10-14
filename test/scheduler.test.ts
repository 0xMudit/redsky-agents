import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as path from 'node:path'
import { createScheduler, nextDelayMs, type CronRow, type SchedulerHandle } from '../electron/scheduler'
import { cleanupTempHomes, drainMicrotasks, readJsonFile, useTempHome } from './helpers'

const MINUTE = 60_000
const HOUR = 3_600_000

describe('nextDelayMs', () => {
  it('parses minute intervals', () => {
    assert.equal(nextDelayMs('every 1 m'), MINUTE)
    assert.equal(nextDelayMs('every 30 m'), 30 * MINUTE)
    assert.equal(nextDelayMs('every 15 minutes'), 15 * MINUTE)
    assert.equal(nextDelayMs('every 2 mins'), 2 * MINUTE)
  })

  it('parses hour intervals', () => {
    assert.equal(nextDelayMs('every 1 h'), HOUR)
    assert.equal(nextDelayMs('every 2 h'), 2 * HOUR)
    assert.equal(nextDelayMs('every 3 hours'), 3 * HOUR)
    assert.equal(nextDelayMs('every 4 hrs'), 4 * HOUR)
  })

  it('is case- and whitespace-insensitive', () => {
    assert.equal(nextDelayMs('EVERY 10 MINS'), 10 * MINUTE)
    assert.equal(nextDelayMs('  every 2 h  '), 2 * HOUR)
  })

  it('resolves a daily clock time against a fixed instant', () => {
    const eight = new Date(2026, 0, 1, 8, 0, 0, 0).getTime()
    assert.equal(nextDelayMs('09:00', eight), HOUR)
    assert.equal(nextDelayMs('daily 09:30', eight), 90 * MINUTE)
    assert.equal(nextDelayMs('08:00', eight), 24 * HOUR)
  })

  it('rolls a clock time that already passed today into tomorrow', () => {
    const late = new Date(2026, 0, 1, 23, 0, 0, 0).getTime()
    assert.equal(nextDelayMs('09:00', late), 10 * HOUR)
  })

  it('resolves a one-off date and time against a fixed instant', () => {
    const base = new Date(2026, 0, 1, 8, 0, 0, 0).getTime()
    assert.equal(nextDelayMs('once 2026-01-01 09:00', base), HOUR)
    assert.equal(nextDelayMs('once 2026-01-02 08:00', base), 24 * HOUR)
    // A date without a time defaults to 09:00.
    assert.equal(nextDelayMs('once 2026-01-01', base), HOUR)
    assert.equal(nextDelayMs('ONCE 2026-01-01 10:00', base), 2 * HOUR)
  })

  it('rejects a one-off in the past or on an impossible day', () => {
    const base = new Date(2026, 0, 1, 8, 0, 0, 0).getTime()
    assert.equal(nextDelayMs('once 2025-12-31 09:00', base), null)
    assert.equal(nextDelayMs('once 2026-01-01 07:00', base), null)
    assert.equal(nextDelayMs('once 2026-02-30 09:00', base), null)
    assert.equal(nextDelayMs('once 2026-13-01 09:00', base), null)
  })

  it('rejects anything it cannot honor', () => {
    for (const bad of [
      '',
      'whenever',
      'every',
      'every 30 s',
      '30 m',
      'every 0 m',
      'every -5 m',
      'at 9am',
      '25:00',
      '09:99',
      '24:00',
      'once',
      'once 09:00',
      'once 2026-01-01 25:00',
    ]) {
      assert.equal(nextDelayMs(bad), null, `expected null for ${JSON.stringify(bad)}`)
    }
  })
})

describe('createScheduler', () => {
  const live = new Set<SchedulerHandle>()

  /** Always build through this so no test leaks a live timer. */
  function scheduler(onFire: (row: CronRow) => void | Promise<void> = () => undefined): SchedulerHandle {
    const handle = createScheduler(onFire)
    live.add(handle)
    return handle
  }

  const routinesFile = (): string => path.join(process.env.REDSKY_TEST_HOME ?? '', 'routines.json')

  beforeEach(() => {
    useTempHome()
  })

  afterEach(() => {
    for (const handle of live) handle.stop()
    live.clear()
    cleanupTempHomes()
  })

  it('accepts a valid schedule and returns the new routine', () => {
    const s = scheduler()
    const row = s.add('bot_1', 'every 30 m', 'check the pipeline')

    assert.match(row.id, /^job_/)
    assert.equal(row.botId, 'bot_1')
    assert.equal(row.schedule, 'every 30 m')
    assert.equal(row.prompt, 'check the pipeline')
    assert.equal(row.enabled, true)
    assert.equal(row.origin, 'manual')
    assert.deepEqual(s.rows(), [row])
  })

  it('rejects an unrecognized schedule instead of silently doing nothing', () => {
    const s = scheduler()
    assert.throws(() => s.add('bot_1', 'whenever', 'do it'), /unrecognized schedule/)
    assert.equal(s.rows().length, 0)
  })

  it('trims the schedule and the prompt', () => {
    const row = scheduler().add('bot_1', '  every 2 h  ', '  digest  ')
    assert.equal(row.schedule, 'every 2 h')
    assert.equal(row.prompt, 'digest')
  })

  it('persists to routines.json', () => {
    const s = scheduler()
    s.add('bot_1', 'every 1 h', 'digest')

    const onDisk = readJsonFile<CronRow[]>(routinesFile())
    assert.equal(onDisk.length, 1)
    assert.equal(onDisk[0].prompt, 'digest')
    assert.equal(onDisk[0].schedule, 'every 1 h')
  })

  it('hands out copies, so callers cannot mutate stored rows', () => {
    const s = scheduler()
    s.add('bot_1', 'every 1 h', 'digest')

    const [copy] = s.rows()
    copy.prompt = 'tampered'
    copy.enabled = false

    assert.equal(s.rows()[0].prompt, 'digest')
    assert.equal(s.rows()[0].enabled, true)
  })

  it('enables, disables, and removes routines', () => {
    const s = scheduler()
    const row = s.add('bot_1', 'every 1 h', 'digest')

    s.setEnabled(row.id, false)
    assert.equal(s.rows()[0].enabled, false)

    s.setEnabled(row.id, true)
    assert.equal(s.rows()[0].enabled, true)

    s.remove(row.id)
    assert.deepEqual(s.rows(), [])
    assert.deepEqual(readJsonFile<CronRow[]>(routinesFile()), [])
  })

  it('ignores a toggle for an unknown id', () => {
    const s = scheduler()
    const row = s.add('bot_1', 'every 1 h', 'digest')
    s.setEnabled('job_nope', false)
    assert.equal(s.rows()[0].id, row.id)
    assert.equal(s.rows()[0].enabled, true)
  })

  it('replaces an identical reminder instead of stacking duplicates', () => {
    const s = scheduler()
    s.add('bot_1', 'every 30 m', 'drink water', 'reminder')
    s.add('bot_1', 'every 30 m', 'DRINK WATER', 'reminder')
    assert.equal(s.rows().length, 1)
  })

  it('keeps two different reminders', () => {
    const s = scheduler()
    s.add('bot_1', 'every 30 m', 'drink water', 'reminder')
    s.add('bot_1', 'every 1 h', 'stand up', 'reminder')
    assert.equal(s.rows().length, 2)
  })

  it('removes only the reminders of the given bot', () => {
    const s = scheduler()
    s.add('bot_1', 'every 30 m', 'drink water', 'reminder')
    s.add('bot_1', 'every 1 h', 'stand up', 'reminder')
    const digest = s.add('bot_2', 'every 2 h', 'digest', 'reminder')
    const manual = s.add('bot_1', 'every 1 h', 'weekly review', 'manual')

    assert.equal(s.removeReminders('bot_1'), 2)
    assert.deepEqual(s.rows().map((r) => r.prompt).sort(), ['digest', 'weekly review'])
    // Both sides are sorted: ids carry a random suffix, so their order is not
    // stable across runs.
    assert.deepEqual(s.rows().map((r) => r.id).sort(), [digest.id, manual.id].sort())
  })

  it('returns 0 when a bot has no reminders', () => {
    const s = scheduler()
    s.add('bot_1', 'every 1 h', 'digest')
    assert.equal(s.removeReminders('bot_1'), 0)
    assert.equal(s.rows().length, 1)
  })

  it('rebuilds its timers from disk on restart', () => {
    const first = scheduler()
    const row = first.add('bot_1', 'every 2 h', 'digest')
    first.stop()

    const second = scheduler()
    assert.equal(second.rows().length, 1)
    assert.equal(second.rows()[0].id, row.id)
    assert.equal(second.rows()[0].prompt, 'digest')
  })

  it('fires a routine when its interval elapses, then re-arms', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const fired: CronRow[] = []
      const s = scheduler((row) => {
        fired.push(row)
      })
      s.add('bot_1', 'every 1 m', 'check the inbox')

      t.mock.timers.tick(MINUTE)
      await drainMicrotasks()

      assert.equal(fired.length, 1)
      assert.equal(fired[0].prompt, 'check the inbox')
      assert.equal(typeof s.rows()[0].lastRun, 'number')

      // The timer was re-armed, so the next interval fires again.
      t.mock.timers.tick(MINUTE)
      await drainMicrotasks()
      assert.equal(fired.length, 2)
    } finally {
      t.mock.timers.reset()
    }
  })

  it('does not fire a disabled routine', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const fired: CronRow[] = []
      const s = scheduler((row) => {
        fired.push(row)
      })
      const row = s.add('bot_1', 'every 1 m', 'check the inbox')
      s.setEnabled(row.id, false)

      t.mock.timers.tick(5 * MINUTE)
      await drainMicrotasks()

      assert.equal(fired.length, 0)
    } finally {
      t.mock.timers.reset()
    }
  })

  it('stops firing after stop()', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const fired: CronRow[] = []
      const s = scheduler((row) => {
        fired.push(row)
      })
      s.add('bot_1', 'every 1 m', 'check the inbox')
      s.stop()

      t.mock.timers.tick(5 * MINUTE)
      await drainMicrotasks()

      assert.equal(fired.length, 0)
    } finally {
      t.mock.timers.reset()
    }
  })

  it('fires a one-off once, then disables it instead of re-arming', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const fired: CronRow[] = []
      const s = scheduler((row) => {
        fired.push(row)
      })
      const at = new Date(Date.now() + 2 * MINUTE)
      const iso = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
      const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
      const row = s.add('bot_1', `once ${iso} ${hhmm}`, 'ship the release')
      assert.equal(row.enabled, true)

      t.mock.timers.tick(3 * MINUTE)
      await drainMicrotasks()

      assert.equal(fired.length, 1)
      assert.equal(s.rows()[0].enabled, false)

      // Spent one-offs stay silent.
      t.mock.timers.tick(10 * MINUTE)
      await drainMicrotasks()
      assert.equal(fired.length, 1)
    } finally {
      t.mock.timers.reset()
    }
  })
})

import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { after, describe, it } from 'node:test'
import { createBotStore, HUES } from '../electron/store'
import { cleanupTempHomes, useTempHome, readJsonFile } from './helpers'

after(cleanupTempHomes)

function makeBotStore() {
  useTempHome()
  return createBotStore()
}

function bot(overrides: Record<string, unknown> = {}) {
  const now = Date.now()
  return {
    id: `bot_${Math.random().toString(36).slice(2)}`,
    name: 'Test Bot',
    job: 'do stuff',
    hue: HUES[0],
    sessionId: 'sess_1',
    status: 'idle' as const,
    preview: '',
    thread: [],
    computer: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

// ── CRUD ────────────────────────────────────────────────────────────────────

describe('BotStore — CRUD', () => {
  it('starts empty', () => {
    assert.equal(makeBotStore().list().length, 0)
  })

  it('upsert inserts a new bot', () => {
    const store = makeBotStore()
    const b = bot()
    store.upsert(b)
    assert.equal(store.list().length, 1)
    assert.equal(store.get(b.id)?.name, 'Test Bot')
  })

  it('upsert updates an existing bot in-place', () => {
    const store = makeBotStore()
    const b = bot()
    store.upsert(b)
    store.upsert({ ...b, name: 'Renamed' })
    assert.equal(store.list().length, 1)
    assert.equal(store.get(b.id)?.name, 'Renamed')
  })

  it('delete removes the bot and returns undefined on get', () => {
    const store = makeBotStore()
    const b = bot()
    store.upsert(b)
    store.delete(b.id)
    assert.equal(store.list().length, 0)
    assert.equal(store.get(b.id), undefined)
  })

  it('delete a non-existent id is a no-op', () => {
    const store = makeBotStore()
    assert.doesNotThrow(() => store.delete('no-such-id'))
  })
})

// ── Sort order ───────────────────────────────────────────────────────────────

describe('BotStore — sort order', () => {
  it('list returns bots sorted by updatedAt descending', () => {
    const store = makeBotStore()
    const b1 = bot({ updatedAt: 1000 })
    const b2 = bot({ updatedAt: 3000 })
    const b3 = bot({ updatedAt: 2000 })
    store.upsert(b1)
    store.upsert(b2)
    store.upsert(b3)
    const ids = store.list().map((b) => b.id)
    assert.deepEqual(ids, [b2.id, b3.id, b1.id])
  })
})

// ── Persistence ──────────────────────────────────────────────────────────────

describe('BotStore — persistence', () => {
  it('survives a store restart (data written to disk)', () => {
    const home = useTempHome()
    const store1 = createBotStore()
    const b = bot()
    store1.upsert(b)

    // Read the file directly to confirm it was written
    const rows = readJsonFile<unknown[]>(path.join(home, 'bots.json'))
    assert.equal(rows.length, 1)

    // Fresh store reads from disk
    const store2 = createBotStore()
    assert.equal(store2.list().length, 1)
    assert.equal(store2.get(b.id)?.name, 'Test Bot')
  })

  it('emits a change event after upsert', () => {
    const store = makeBotStore()
    let fired = false
    store.changes.once('updated', () => { fired = true })
    store.upsert(bot())
    assert.equal(fired, true)
  })

  it('emits a deleted event after delete', () => {
    const store = makeBotStore()
    const b = bot()
    store.upsert(b)
    let deletedId = ''
    store.changes.once('deleted', (id: string) => { deletedId = id })
    store.delete(b.id)
    assert.equal(deletedId, b.id)
  })
})

// ── Legacy migration ─────────────────────────────────────────────────────────

describe('BotStore — legacy tasks.json migration', () => {
  it('migrates legacy tasks.json when bots.json is missing', () => {
    const home = useTempHome()
    const legacyTasks = [
      {
        id: 'old_1',
        title: 'Legacy Task',
        prompt: 'do the thing',
        transcript: 'I did the thing',
        status: 'idle',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]
    fs.writeFileSync(path.join(home, 'tasks.json'), JSON.stringify(legacyTasks))

    const store = createBotStore()
    assert.equal(store.list().length, 1)
    assert.equal(store.list()[0].name, 'Legacy Task')
    assert.equal(store.list()[0].thread.length, 2)
    // Migrated to bots.json
    assert.ok(fs.existsSync(path.join(home, 'bots.json')))
  })

  it('ignores a corrupted tasks.json and starts empty', () => {
    const home = useTempHome()
    fs.writeFileSync(path.join(home, 'tasks.json'), '{ broken json')
    const store = createBotStore()
    assert.equal(store.list().length, 0)
  })
})

// ── HUES cycling ─────────────────────────────────────────────────────────────

describe('HUES', () => {
  it('exports a non-empty array of hex color strings', () => {
    assert.ok(HUES.length > 0)
    for (const h of HUES) assert.match(h, /^#[0-9a-fA-F]{6}$/)
  })
})

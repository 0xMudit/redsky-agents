import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { createDatabase, toMatchQuery, type Database } from '../electron/database'
import { isSqliteAvailable } from '../electron/lib/sqlite'
import { cleanupTempHomes, useTempHome } from './helpers'

// `node:sqlite` needs Node 22.13+. On older runtimes the whole database layer is
// inert (every feature falls back), so the suite is skipped rather than failed.
const suite = isSqliteAvailable() ? describe : describe.skip

const open: Database[] = []

function makeDb(): Database {
  useTempHome()
  const db = createDatabase()
  open.push(db)
  db.init()
  return db
}

afterEach(() => {
  for (const db of open.splice(0)) db.close()
  cleanupTempHomes()
})

// ── toMatchQuery ───────────────────────────────────────────────────────────────

suite('toMatchQuery', () => {
  it('builds prefix-ANDed terms and drops punctuation', () => {
    assert.equal(toMatchQuery('Offsite budget!'), '"offsite"* "budget"*')
  })

  it('returns an empty string when there are no content words', () => {
    assert.equal(toMatchQuery('the a is of'), '')
    assert.equal(toMatchQuery('?!...'), '')
  })

  it('de-duplicates repeated terms', () => {
    assert.equal(toMatchQuery('budget budget budget'), '"budget"*')
  })
})

// ── messages + full-text search ──────────────────────────────────────────────────

suite('database — messages', () => {
  it('indexes a turn and finds it by full-text search', () => {
    const db = makeDb()
    db.messages.index({ id: 'm1', role: 'user', text: 'the offsite budget is five thousand dollars', botId: 'b1', botName: 'Chief' })
    db.messages.index({ id: 'm2', role: 'assistant', text: 'unrelated note about coffee beans', botId: 'b1', botName: 'Chief' })

    const hits = db.messages.search('offsite budget')
    assert.equal(hits.length, 1)
    assert.equal(hits[0].id, 'm1')
    assert.match(hits[0].snippet, /\[offsite\]/)
    assert.equal(db.messages.count(), 2)
  })

  it('supports prefix (as-you-type) search', () => {
    const db = makeDb()
    db.messages.index({ id: 'm1', role: 'user', text: 'sign the venue contract', botId: 'b1', botName: 'Chief' })
    const hits = db.messages.search('cont')
    assert.equal(hits.length, 1)
    assert.equal(hits[0].id, 'm1')
  })

  it('is idempotent for a repeated id', () => {
    const db = makeDb()
    assert.equal(db.messages.index({ id: 'same', role: 'user', text: 'hello there', botId: 'b', botName: 'B' }), true)
    assert.equal(db.messages.index({ id: 'same', role: 'user', text: 'hello there', botId: 'b', botName: 'B' }), false)
    assert.equal(db.messages.count(), 1)
  })

  it('backfills turns once and is idempotent', () => {
    const db = makeDb()
    const turns = [
      { id: 'a', role: 'user' as const, text: 'alpha thing', botId: 'b1', botName: 'One' },
      { id: 'b', role: 'assistant' as const, text: 'beta thing', botId: 'b1', botName: 'One' },
    ]
    assert.equal(db.messages.backfill(turns), 2)
    assert.equal(db.messages.backfill(turns), 0)
    assert.equal(db.messages.count(), 2)
  })

  it('ignores blank text', () => {
    const db = makeDb()
    assert.equal(db.messages.index({ role: 'user', text: '   ', botId: 'b', botName: 'B' }), false)
    assert.equal(db.messages.count(), 0)
  })

  it('scopes search by user', () => {
    const db = makeDb()
    db.messages.index({ id: 'm1', role: 'user', text: 'the offsite budget is five thousand', botId: 'b1', botName: 'Chief', user: 'Mudit' })
    db.messages.index({ id: 'm2', role: 'user', text: 'the offsite budget is two hundred', botId: 'b1', botName: 'Chief', user: 'Priya' })
    const hits = db.messages.search('offsite budget', { user: 'Mudit' })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].id, 'm1')
  })

  it('scopes search by bot', () => {
    const db = makeDb()
    db.messages.index({ id: 'm1', role: 'user', text: 'renew the acme contract', botId: 'scout', botName: 'Scout' })
    db.messages.index({ id: 'm2', role: 'user', text: 'renew the acme contract', botId: 'chief', botName: 'Chief' })
    const hits = db.messages.search('acme contract', { botId: 'scout' })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].id, 'm1')
  })

  it('returns most-recent first when the query has no content words', () => {
    const db = makeDb()
    db.messages.index({ id: 'm1', role: 'user', text: 'first thing', botId: 'b1', botName: 'One', at: 1000 })
    db.messages.index({ id: 'm2', role: 'user', text: 'second thing', botId: 'b1', botName: 'One', at: 2000 })
    const hits = db.messages.search('the a is')
    assert.equal(hits[0].id, 'm2')
  })
})

// ── settings key/value ──────────────────────────────────────────────────────────

suite('database — settings', () => {
  it('round-trips a value and overwrites in place', () => {
    const db = makeDb()
    db.settings.set('app', { privacyMode: true })
    assert.deepEqual(db.settings.get('app'), { privacyMode: true })
    db.settings.set('app', { privacyMode: false, maxParallelBots: 4 })
    assert.deepEqual(db.settings.get('app'), { privacyMode: false, maxParallelBots: 4 })
  })

  it('returns undefined for a missing key', () => {
    assert.equal(makeDb().settings.get('nope'), undefined)
  })

  it('lists every key', () => {
    const db = makeDb()
    db.settings.set('a', 1)
    db.settings.set('b', 'two')
    assert.deepEqual(db.settings.all(), { a: 1, b: 'two' })
  })
})

// ── profile ───────────────────────────────────────────────────────────────────

suite('database — profile', () => {
  it('replaces and lists durable facts', () => {
    const db = makeDb()
    db.profile.replace([
      { id: 'f1', key: 'tone', value: 'prefers short emails', createdAt: 1, updatedAt: 1 },
      { id: 'f2', key: 'tz', value: 'GMT+5:30', botId: 'bot_a', createdAt: 1, updatedAt: 1 },
    ])
    const all = db.profile.list()
    assert.equal(all.length, 2)
    const scoped = db.profile.list('bot_a')
    assert.equal(scoped.length, 2) // global facts are always included
    assert.ok(scoped.some((r) => r.key === 'tz'))
  })

  it('drops rows no longer present on replace', () => {
    const db = makeDb()
    db.profile.replace([{ id: 'f1', key: 'a', value: '1', createdAt: 1, updatedAt: 1 }])
    db.profile.replace([{ id: 'f2', key: 'b', value: '2', createdAt: 2, updatedAt: 2 }])
    assert.deepEqual(db.profile.list().map((r) => r.key), ['b'])
  })
})

// ── events ───────────────────────────────────────────────────────────────────

suite('database — events', () => {
  it('appends events, newest first, with props', () => {
    const db = makeDb()
    db.events.add({ type: 'prompt', name: 'send', botId: 'b1', props: { length: 12 } })
    db.events.add({ type: 'search', name: 'query', props: { query: 'budget' } })
    const rows = db.events.list()
    assert.equal(db.events.count(), 2)
    assert.equal(rows[0].type, 'search')
    assert.deepEqual(rows[0].props, { query: 'budget' })
  })

  it('filters by type', () => {
    const db = makeDb()
    db.events.add({ type: 'prompt', name: 'send' })
    db.events.add({ type: 'search', name: 'query' })
    assert.equal(db.events.list({ type: 'prompt' }).length, 1)
  })

  it('rejects an event without a type or name', () => {
    assert.equal(makeDb().events.add({ type: '', name: 'x' }), undefined)
  })
})

// ── stats + availability ────────────────────────────────────────────────────────

suite('database — stats', () => {
  it('reports counts across tables', () => {
    const db = makeDb()
    db.messages.index({ id: 'm1', role: 'user', text: 'hello', botId: 'b', botName: 'B' })
    db.events.add({ type: 'app', name: 'ready' })
    assert.deepEqual(db.stats(), { messages: 1, events: 1, profile: 0, notes: 0 })
  })

  it('reports the database as available on this runtime', () => {
    assert.equal(makeDb().available, true)
  })
})

// ── notes ───────────────────────────────────────────────────────────────────────

suite('database — notes', () => {
  it('creates, reads, and lists notes newest-first', () => {
    const db = makeDb()
    const first = db.notes.create({ title: 'Offsite', body: 'Book the venue', tags: ['work', 'work'] })
    const second = db.notes.create({ title: 'Ideas', body: 'Ship notes' })
    assert.equal(first.title, 'Offsite')
    assert.deepEqual(first.tags, ['work'])
    assert.equal(db.notes.get(first.id)?.body, 'Book the venue')
    assert.deepEqual(
      db.notes.list().map((n) => n.id),
      [second.id, first.id],
    )
    assert.equal(db.notes.count(), 2)
  })

  it('floats pinned notes to the top regardless of recency', () => {
    const db = makeDb()
    const older = db.notes.create({ title: 'Old', body: 'x' })
    const newer = db.notes.create({ title: 'New', body: 'y' })
    db.notes.update(older.id, { pinned: true })
    assert.equal(db.notes.list()[0].id, older.id)
    assert.equal(db.notes.list()[1].id, newer.id)
  })

  it('updates fields and appends captured text with a blank line', () => {
    const db = makeDb()
    const note = db.notes.create({ title: 'Log', body: 'first' })
    const updated = db.notes.update(note.id, { title: 'Log 2', tags: ['a'] })
    assert.equal(updated?.title, 'Log 2')
    const appended = db.notes.append(note.id, 'second')
    assert.equal(appended?.body, 'first\n\nsecond')
    assert.equal(db.notes.append('missing', 'x'), undefined)
  })

  it('deletes notes', () => {
    const db = makeDb()
    const note = db.notes.create({ title: 'Temp' })
    assert.equal(db.notes.remove(note.id), true)
    assert.equal(db.notes.get(note.id), undefined)
    assert.equal(db.notes.remove('missing'), false)
  })

  it('searches title and body via FTS, and falls back to recents on an empty query', () => {
    const db = makeDb()
    db.notes.create({ title: 'Quarterly budget', body: 'spend on infra' })
    db.notes.create({ title: 'Reading list', body: 'book wishlist' })
    const hits = db.notes.search('budget')
    assert.equal(hits.length, 1)
    assert.equal(hits[0].title, 'Quarterly budget')
    assert.match(hits[0].snippet, /budget/i)
    assert.equal(db.notes.search('the a is of').length, 2)
  })
})

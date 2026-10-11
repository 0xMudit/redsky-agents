import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createNoticeStore } from '../electron/notices'
import { cleanupTempHomes, useTempHome } from './helpers'

after(cleanupTempHomes)

function makeStore() {
  useTempHome()
  return createNoticeStore()
}

function notice(overrides: Record<string, unknown> = {}) {
  return { kind: 'done' as const, botId: 'bot_1', title: 'Done', body: 'All finished.', ...overrides }
}

// ── add ───────────────────────────────────────────────────────────────────────

describe('NoticeStore — add', () => {
  it('returns a notice with id, at, read=false', () => {
    const n = makeStore().add(notice())
    assert.ok(n.id)
    assert.ok(n.at > 0)
    assert.equal(n.read, false)
  })

  it('stores all notice kinds: done, waiting, error, reminder', () => {
    const store = makeStore()
    for (const kind of ['done', 'waiting', 'error', 'reminder'] as const) {
      const n = store.add(notice({ kind }))
      assert.equal(n.kind, kind)
    }
  })

  it('truncates body to 280 characters', () => {
    const store = makeStore()
    const n = store.add(notice({ body: 'x'.repeat(400) }))
    assert.equal(n.body.length, 280)
  })

  it('list returns newest first', () => {
    const store = makeStore()
    store.add(notice({ title: 'First' }))
    store.add(notice({ title: 'Second' }))
    const list = store.list()
    assert.equal(list[0].title, 'Second')
  })
})

// ── cap at 80 ─────────────────────────────────────────────────────────────────

describe('NoticeStore — cap at 80', () => {
  it('never stores more than 80 notices', () => {
    const store = makeStore()
    for (let i = 0; i < 90; i++) store.add(notice({ title: `Notice ${i}` }))
    assert.ok(store.list().length <= 80)
  })

  it('keeps the most recent 80 when over the cap', () => {
    const store = makeStore()
    for (let i = 0; i < 85; i++) store.add(notice({ title: `Notice ${i}` }))
    const list = store.list()
    assert.equal(list[0].title, 'Notice 84') // newest first
    assert.equal(list.length, 80)
  })
})

// ── markRead ─────────────────────────────────────────────────────────────────

describe('NoticeStore — markRead', () => {
  it('marks a single notice as read', () => {
    const store = makeStore()
    const n = store.add(notice())
    store.markRead(n.id)
    assert.equal(store.list().find((x) => x.id === n.id)?.read, true)
  })

  it('does not affect other notices', () => {
    const store = makeStore()
    const n1 = store.add(notice({ title: 'A' }))
    store.add(notice({ title: 'B' }))
    store.markRead(n1.id)
    assert.equal(store.list().filter((n) => !n.read).length, 1)
  })

  it('markRead on unknown id is a no-op', () => {
    const store = makeStore()
    assert.doesNotThrow(() => store.markRead('no-such-id'))
  })
})

// ── markAllRead ───────────────────────────────────────────────────────────────

describe('NoticeStore — markAllRead', () => {
  it('marks every notice as read', () => {
    const store = makeStore()
    for (let i = 0; i < 5; i++) store.add(notice())
    store.markAllRead()
    assert.ok(store.list().every((n) => n.read))
  })
})

// ── clear ─────────────────────────────────────────────────────────────────────

describe('NoticeStore — clear', () => {
  it('removes all notices', () => {
    const store = makeStore()
    store.add(notice())
    store.add(notice())
    store.clear()
    assert.equal(store.list().length, 0)
  })
})

// ── persistence ───────────────────────────────────────────────────────────────

describe('NoticeStore — persistence', () => {
  it('notices survive a store restart', () => {
    useTempHome()
    createNoticeStore().add(notice({ title: 'Persisted' }))
    const list = createNoticeStore().list()
    assert.equal(list.length, 1)
    assert.equal(list[0].title, 'Persisted')
  })
})

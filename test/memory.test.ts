import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createMemoryStore, extractMemoryLines } from '../electron/memory'
import { cleanupTempHomes, useTempHome } from './helpers'

after(cleanupTempHomes)

function makeStore() {
  useTempHome()
  return createMemoryStore()
}

// ── extractMemoryLines ────────────────────────────────────────────────────────

describe('extractMemoryLines', () => {
  it('extracts a "Noted for next time:" line', () => {
    const lines = extractMemoryLines('Noted for next time: prefer TypeScript over JS')
    assert.equal(lines.length, 1)
    assert.equal(lines[0].value, 'prefer TypeScript over JS')
  })

  it('extracts multiple lines from one text', () => {
    const text = [
      'Great work done.',
      'Noted for next time: use snake_case for filenames',
      'Also some filler.',
      'Noted for next time: run tests before commit',
    ].join('\n')
    const lines = extractMemoryLines(text)
    assert.equal(lines.length, 2)
  })

  it('handles "Updated memory:" prefix', () => {
    const lines = extractMemoryLines('Updated memory: client prefers weekly summaries')
    assert.equal(lines.length, 1)
    assert.equal(lines[0].value, 'client prefers weekly summaries')
  })

  it('deduplicates identical key+value pairs within the same text', () => {
    const text = 'Noted for next time: use dark mode\nNoted for next time: use dark mode'
    assert.equal(extractMemoryLines(text).length, 1)
  })

  it('is case-insensitive for the trigger phrase', () => {
    assert.equal(extractMemoryLines('NOTED FOR NEXT TIME: ALL CAPS VALUE').length, 1)
  })

  it('returns empty for text with no memory lines', () => {
    assert.equal(extractMemoryLines('Just a normal message with no notes.').length, 0)
    assert.equal(extractMemoryLines('').length, 0)
  })

  it('trims trailing punctuation from the key', () => {
    const lines = extractMemoryLines('Noted for next time: always validate input.')
    assert.ok(!lines[0].key.endsWith('.'))
  })
})

// ── add / list ────────────────────────────────────────────────────────────────

describe('MemoryStore — add and list', () => {
  it('add returns a row with id, key, value', () => {
    const store = makeStore()
    const row = store.add('pref', 'dark mode', 'bot1')
    assert.ok(row.id)
    assert.equal(row.key, 'pref')
    assert.equal(row.value, 'dark mode')
    assert.equal(row.botId, 'bot1')
  })

  it('list returns all rows sorted by updatedAt descending', () => {
    const store = makeStore()
    store.add('a', '1')
    store.add('b', '2')
    const list = store.list()
    assert.equal(list.length, 2)
    assert.ok(list[0].updatedAt >= list[1].updatedAt)
  })

  it('list filters by botId when supplied', () => {
    const store = makeStore()
    store.add('shared', 'val')
    store.add('mine', 'val', 'bot_x')
    store.add('theirs', 'val', 'bot_y')
    const forX = store.list('bot_x')
    assert.ok(forX.every((r) => !r.botId || r.botId === 'bot_x'))
  })
})

// ── search ────────────────────────────────────────────────────────────────────

describe('MemoryStore — search', () => {
  it('returns rows matching the query keyword', () => {
    const store = makeStore()
    store.add('budget', 'keep ad spend under $500')
    store.add('style', 'use dark mode always')
    store.add('deadline', 'ship by Friday')
    const results = store.search('dark mode')
    assert.ok(results.some((r) => r.key === 'style'))
  })

  it('returns up to k results', () => {
    const store = makeStore()
    for (let i = 0; i < 10; i++) store.add(`key${i}`, `value contains word`)
    assert.ok(store.search('word', 3).length <= 3)
  })

  it('returns top rows (no filter) when query is empty', () => {
    const store = makeStore()
    store.add('a', '1')
    store.add('b', '2')
    assert.equal(store.search('', 10).length, 2)
  })

  it('ranks higher-frequency keyword matches first', () => {
    const store = makeStore()
    store.add('weak', 'mentions budget once')
    store.add('strong', 'budget budget budget budget')
    const results = store.search('budget', 5)
    assert.equal(results[0].key, 'strong')
  })
})

// ── harvestFromText ───────────────────────────────────────────────────────────

describe('MemoryStore — harvestFromText', () => {
  it('adds rows from text and returns them', () => {
    const store = makeStore()
    const added = store.harvestFromText('Noted for next time: always format with prettier', 'bot1')
    assert.equal(added.length, 1)
    assert.equal(store.list('bot1').length, 1)
  })

  it('adds nothing when text has no memory markers', () => {
    const store = makeStore()
    store.harvestFromText('Just a normal reply with no notes.')
    assert.equal(store.list().length, 0)
  })
})

// ── remove / clear ────────────────────────────────────────────────────────────

describe('MemoryStore — remove and clear', () => {
  it('remove deletes a single row by id', () => {
    const store = makeStore()
    const row = store.add('k', 'v')
    store.remove(row.id)
    assert.equal(store.list().length, 0)
  })

  it('remove a non-existent id is a no-op', () => {
    const store = makeStore()
    assert.doesNotThrow(() => store.remove('no-such-id'))
  })

  it('clear removes all rows and persists', () => {
    const store = makeStore()
    store.add('a', '1')
    store.add('b', '2')
    store.clear()
    assert.equal(store.list().length, 0)
    // Verify persisted
    useTempHome()
    const store2 = createMemoryStore()
    store2.add('x', 'y')
    store2.clear()
    assert.equal(createMemoryStore().list().length, 0)
  })
})

// ── persistence ───────────────────────────────────────────────────────────────

describe('MemoryStore — persistence', () => {
  it('rows survive a store restart', () => {
    useTempHome()
    createMemoryStore().add('persist-key', 'persist-value')
    const rows = createMemoryStore().list()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].key, 'persist-key')
  })
})

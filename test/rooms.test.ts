import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createRoomStore } from '../electron/rooms'
import { cleanupTempHomes, useTempHome } from './helpers'

after(cleanupTempHomes)

function makeStore() {
  useTempHome()
  return createRoomStore()
}

// ── create ────────────────────────────────────────────────────────────────────

describe('RoomStore — create', () => {
  it('creates a room with id, title, participantIds', () => {
    const room = makeStore().create('Dev', ['bot_1', 'bot_2'])
    assert.ok(room.id)
    assert.equal(room.title, 'Dev')
    assert.deepEqual(room.participantIds, ['bot_1', 'bot_2'])
  })

  it('deduplicates participants on creation', () => {
    const room = makeStore().create('Dev', ['bot_1', 'bot_1', 'bot_2'])
    assert.equal(room.participantIds.length, 2)
  })

  it('filters out empty participant ids', () => {
    const room = makeStore().create('Dev', ['bot_1', '', 'bot_2'])
    assert.ok(!room.participantIds.includes(''))
  })

  it('falls back to "Thread" when title is empty', () => {
    const room = makeStore().create('', ['bot_1'])
    assert.equal(room.title, 'Thread')
  })

  it('list is sorted by updatedAt descending', () => {
    const store = makeStore()
    store.create('A', ['bot_1'])
    store.create('B', ['bot_2'])
    const titles = store.list().map((r) => r.title)
    assert.equal(titles[0], 'B')
  })
})

// ── addParticipant ────────────────────────────────────────────────────────────

describe('RoomStore — addParticipant', () => {
  it('adds a new participant', () => {
    const store = makeStore()
    const room = store.create('Dev', ['bot_1'])
    store.addParticipant(room.id, 'bot_2')
    assert.ok(store.get(room.id)?.participantIds.includes('bot_2'))
  })

  it('is idempotent — adding the same participant twice is a no-op', () => {
    const store = makeStore()
    const room = store.create('Dev', ['bot_1'])
    store.addParticipant(room.id, 'bot_1')
    assert.equal(store.get(room.id)?.participantIds.length, 1)
  })

  it('throws for an unknown room id', () => {
    assert.throws(() => makeStore().addParticipant('no-such-room', 'bot_1'), /room not found/)
  })
})

// ── rename ────────────────────────────────────────────────────────────────────

describe('RoomStore — rename', () => {
  it('renames a room', () => {
    const store = makeStore()
    const room = store.create('Old', ['bot_1'])
    store.rename(room.id, 'New')
    assert.equal(store.get(room.id)?.title, 'New')
  })

  it('keeps old title when new title is empty', () => {
    const store = makeStore()
    const room = store.create('Keep Me', ['bot_1'])
    store.rename(room.id, '')
    assert.equal(store.get(room.id)?.title, 'Keep Me')
  })

  it('throws for an unknown room id', () => {
    assert.throws(() => makeStore().rename('no-such-room', 'New'), /room not found/)
  })
})

// ── touch ─────────────────────────────────────────────────────────────────────

describe('RoomStore — touch', () => {
  it('updates the preview text', () => {
    const store = makeStore()
    const room = store.create('Dev', ['bot_1'])
    store.touch(room.id, 'latest message here')
    assert.ok(store.get(room.id)?.preview.includes('latest'))
  })

  it('truncates preview to 140 characters', () => {
    const store = makeStore()
    const room = store.create('Dev', ['bot_1'])
    store.touch(room.id, 'x'.repeat(200))
    assert.equal(store.get(room.id)?.preview.length, 140)
  })

  it('returns undefined for an unknown room', () => {
    assert.equal(makeStore().touch('nope', 'msg'), undefined)
  })
})

// ── delete ────────────────────────────────────────────────────────────────────

describe('RoomStore — delete', () => {
  it('removes the room', () => {
    const store = makeStore()
    const room = store.create('Dev', ['bot_1'])
    store.delete(room.id)
    assert.equal(store.list().length, 0)
    assert.equal(store.get(room.id), undefined)
  })

  it('delete a non-existent id is a no-op', () => {
    assert.doesNotThrow(() => makeStore().delete('nope'))
  })
})

// ── persistence ───────────────────────────────────────────────────────────────

describe('RoomStore — persistence', () => {
  it('rooms survive a store restart', () => {
    useTempHome()
    createRoomStore().create('Persisted Room', ['bot_1'])
    assert.equal(createRoomStore().list().length, 1)
    assert.equal(createRoomStore().list()[0].title, 'Persisted Room')
  })
})

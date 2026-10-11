import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createConnectorStore, CONNECTOR_CATALOG, connectorPromptBlock } from '../electron/connectors'
import { cleanupTempHomes, useTempHome } from './helpers'

after(cleanupTempHomes)

function makeStore() {
  useTempHome()
  return createConnectorStore()
}

// ── catalog ───────────────────────────────────────────────────────────────────

describe('ConnectorStore — catalog', () => {
  it('list returns all catalog entries', () => {
    const list = makeStore().list()
    assert.equal(list.length, CONNECTOR_CATALOG.length)
    for (const c of CONNECTOR_CATALOG) {
      assert.ok(list.some((l) => l.id === c.id), `missing ${c.id}`)
    }
  })

  it('all connectors default to disconnected', () => {
    const list = makeStore().list()
    assert.ok(list.every((c) => c.status === 'disconnected'))
  })

  it('every connector has id, name, description, status, updatedAt', () => {
    for (const c of makeStore().list()) {
      assert.ok(c.id)
      assert.ok(c.name)
      assert.ok(c.description)
      assert.ok(c.status)
      assert.ok(c.updatedAt > 0)
    }
  })
})

// ── upsert ────────────────────────────────────────────────────────────────────

describe('ConnectorStore — upsert', () => {
  it('connects a known connector', () => {
    const store = makeStore()
    const result = store.upsert('gmail', 'connected')
    assert.equal(result.status, 'connected')
    assert.equal(store.list().find((c) => c.id === 'gmail')?.status, 'connected')
  })

  it('disconnects a previously connected connector', () => {
    const store = makeStore()
    store.upsert('slack', 'connected')
    store.upsert('slack', 'disconnected')
    assert.equal(store.list().find((c) => c.id === 'slack')?.status, 'disconnected')
  })

  it('stores an optional note', () => {
    const store = makeStore()
    const result = store.upsert('github', 'connected', 'personal token set')
    assert.equal(result.note, 'personal token set')
  })

  it('throws for an unknown connector id', () => {
    assert.throws(() => makeStore().upsert('twitter', 'connected'), /unknown connector/)
  })

  it('supports all valid catalog ids without throwing', () => {
    const store = makeStore()
    for (const c of CONNECTOR_CATALOG) {
      assert.doesNotThrow(() => store.upsert(c.id, 'connected'))
    }
  })
})

// ── persistence ───────────────────────────────────────────────────────────────

describe('ConnectorStore — persistence', () => {
  it('connected status survives a store restart', () => {
    useTempHome()
    createConnectorStore().upsert('notion', 'connected')
    const list = createConnectorStore().list()
    assert.equal(list.find((c) => c.id === 'notion')?.status, 'connected')
  })
})

// ── connectorPromptBlock ──────────────────────────────────────────────────────

describe('connectorPromptBlock', () => {
  it('returns the "none connected" message when all are disconnected', () => {
    const block = connectorPromptBlock(makeStore().list())
    assert.match(block, /none connected/)
  })

  it('lists connected connectors by name', () => {
    const store = makeStore()
    store.upsert('gmail', 'connected')
    store.upsert('slack', 'connected')
    const block = connectorPromptBlock(store.list())
    assert.match(block, /Gmail/)
    assert.match(block, /Slack/)
  })

  it('does not mention disconnected connectors', () => {
    const store = makeStore()
    store.upsert('gmail', 'connected')
    const block = connectorPromptBlock(store.list())
    assert.doesNotMatch(block, /GitHub/)
  })

  it('includes the note when set', () => {
    const store = makeStore()
    store.upsert('github', 'connected', 'org: acme')
    const block = connectorPromptBlock(store.list())
    assert.match(block, /org: acme/)
  })
})

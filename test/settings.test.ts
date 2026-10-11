import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createSettingsStore, DEFAULT_SETTINGS } from '../electron/settings'
import { cleanupTempHomes, useTempHome } from './helpers'

after(cleanupTempHomes)

function makeStore() {
  useTempHome()
  return createSettingsStore()
}

// ── defaults ──────────────────────────────────────────────────────────────────

describe('SettingsStore — defaults', () => {
  it('returns DEFAULT_SETTINGS on first read', () => {
    const s = makeStore().get()
    assert.equal(s.privacyMode, DEFAULT_SETTINGS.privacyMode)
    assert.equal(s.autoReview, DEFAULT_SETTINGS.autoReview)
    assert.equal(s.allowBotHandoff, DEFAULT_SETTINGS.allowBotHandoff)
    assert.equal(s.maxParallelBots, DEFAULT_SETTINGS.maxParallelBots)
    assert.equal(s.version, 1)
  })

  it('privacy mode is ON by default', () => {
    assert.equal(makeStore().get().privacyMode, true)
  })

  it('autoReview defaults to sensitive', () => {
    assert.equal(makeStore().get().autoReview, 'sensitive')
  })
})

// ── normalize ─────────────────────────────────────────────────────────────────

describe('SettingsStore — normalize', () => {
  it('clamps maxParallelBots to [1, 32]', () => {
    assert.equal(makeStore().update({ maxParallelBots: 0 }).maxParallelBots, 1)
    assert.equal(makeStore().update({ maxParallelBots: 999 }).maxParallelBots, 32)
    assert.equal(makeStore().update({ maxParallelBots: 4 }).maxParallelBots, 4)
  })

  it('rejects unknown autoReview values and falls back to sensitive', () => {
    const store = makeStore()
    // Force an invalid value via cast
    const result = store.update({ autoReview: 'unknown' as 'sensitive' })
    assert.equal(result.autoReview, 'sensitive')
  })

  it('accepts all three valid autoReview values', () => {
    const store = makeStore()
    assert.equal(store.update({ autoReview: 'always' }).autoReview, 'always')
    assert.equal(store.update({ autoReview: 'off' }).autoReview, 'off')
    assert.equal(store.update({ autoReview: 'sensitive' }).autoReview, 'sensitive')
  })

  it('coerces privacyMode falsy values correctly', () => {
    const store = makeStore()
    assert.equal(store.update({ privacyMode: false }).privacyMode, false)
    assert.equal(store.update({ privacyMode: true }).privacyMode, true)
  })

  it('always sets version to 1 regardless of what is passed', () => {
    const store = makeStore()
    const result = store.update({ version: 99 as 1 })
    assert.equal(result.version, 1)
  })
})

// ── update ────────────────────────────────────────────────────────────────────

describe('SettingsStore — update', () => {
  it('merges a partial patch', () => {
    const store = makeStore()
    store.update({ privacyMode: false })
    assert.equal(store.get().privacyMode, false)
    assert.equal(store.get().autoReview, 'sensitive') // unchanged
  })

  it('returned value matches what get() returns after update', () => {
    const store = makeStore()
    const returned = store.update({ maxParallelBots: 3 })
    assert.deepEqual(returned, store.get())
  })
})

// ── persistence ───────────────────────────────────────────────────────────────

describe('SettingsStore — persistence', () => {
  it('survives a store restart', () => {
    useTempHome()
    createSettingsStore().update({ privacyMode: false, maxParallelBots: 2 })
    const s = createSettingsStore().get()
    assert.equal(s.privacyMode, false)
    assert.equal(s.maxParallelBots, 2)
  })

  it('normalizes a corrupt file on read — never crashes', () => {
    const { writeFileSync } = require('node:fs') as typeof import('node:fs')
    const { join } = require('node:path') as typeof import('node:path')
    const home = useTempHome()
    // Write a corrupted settings file
    writeFileSync(join(home, 'settings.json'), '{"autoReview":"bananas","maxParallelBots":-5}')
    const s = createSettingsStore().get()
    assert.equal(s.autoReview, 'sensitive')
    assert.equal(s.maxParallelBots, 1) // clamped from -5
  })
})

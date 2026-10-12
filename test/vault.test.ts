import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { after, describe, it } from 'node:test'
import { createVault, tokenize, VaultCorpus } from '../electron/vault'

const roots: string[] = []

function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'red-sky-vault-'))
  roots.push(dir)
  return dir
}

after(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function read(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

// ── init ──────────────────────────────────────────────────────────────────────

describe('vault — init', () => {
  it('creates the schema, index, log, profile, and content directories', () => {
    const root = makeRoot()
    const vault = createVault({ root })
    vault.init()

    assert.ok(fs.existsSync(path.join(root, 'AGENTS.md')))
    assert.ok(fs.existsSync(path.join(root, 'index.md')))
    assert.ok(fs.existsSync(path.join(root, 'log.md')))
    assert.ok(fs.existsSync(path.join(root, 'profile.md')))
    assert.ok(fs.statSync(path.join(root, 'conversations')).isDirectory())
    assert.ok(fs.statSync(path.join(root, 'raw')).isDirectory())
  })

  it('is idempotent and does not clobber existing content', () => {
    const root = makeRoot()
    const vault = createVault({ root })
    vault.recordTurn({ role: 'user', text: 'first question', botId: 'b1', botName: 'One' })
    const before = read(path.join(root, 'index.md'))
    vault.init()
    assert.equal(read(path.join(root, 'index.md')), before)
  })

  it('exposes a schema describing the layout', () => {
    const vault = createVault({ root: makeRoot() })
    assert.match(vault.schema(), /conversations\/<agent>\.md/)
    assert.match(vault.schema(), /Noted for next time/)
  })
})

// ── recordTurn ────────────────────────────────────────────────────────────────

describe('vault — recordTurn', () => {
  it('writes raw JSONL, a conversation page, the index, and the log', () => {
    const root = makeRoot()
    const vault = createVault({ root })
    vault.recordTurn({ id: 'm1', role: 'user', text: 'Book the venue', botId: 'bot_a', botName: 'Chief' })

    const raw = read(path.join(root, 'raw', 'bot_a.jsonl')).trim().split('\n')
    assert.equal(raw.length, 1)
    const rec = JSON.parse(raw[0]) as { id: string; role: string; text: string; botId: string }
    assert.equal(rec.id, 'm1')
    assert.equal(rec.role, 'user')
    assert.equal(rec.text, 'Book the venue')
    assert.equal(rec.botId, 'bot_a')

    assert.match(read(path.join(root, 'conversations', 'bot_a.md')), /Book the venue/)
    assert.match(read(path.join(root, 'index.md')), /Chief/)
    assert.match(read(path.join(root, 'log.md')), /## \[.*\] turn \| Chief/)
  })

  it('is idempotent for a repeated message id', () => {
    const root = makeRoot()
    const vault = createVault({ root })
    vault.recordTurn({ id: 'same', role: 'user', text: 'hello there', botId: 'b', botName: 'B' })
    const second = vault.recordTurn({ id: 'same', role: 'user', text: 'hello there', botId: 'b', botName: 'B' })
    assert.equal(second, undefined)
    assert.equal(vault.turns().length, 1)
    assert.equal(read(path.join(root, 'raw', 'b.jsonl')).trim().split('\n').length, 1)
  })

  it('ignores blank text', () => {
    const vault = createVault({ root: makeRoot() })
    assert.equal(vault.recordTurn({ role: 'assistant', text: '   ', botId: 'b', botName: 'B' }), undefined)
    assert.equal(vault.turns().length, 0)
  })

  it('keeps each teammate in its own file', () => {
    const root = makeRoot()
    const vault = createVault({ root })
    vault.recordTurn({ role: 'user', text: 'alpha request', botId: 'bot_a', botName: 'A' })
    vault.recordTurn({ role: 'user', text: 'beta request', botId: 'bot_b', botName: 'B' })
    assert.ok(fs.existsSync(path.join(root, 'raw', 'bot_a.jsonl')))
    assert.ok(fs.existsSync(path.join(root, 'raw', 'bot_b.jsonl')))
    assert.ok(fs.existsSync(path.join(root, 'conversations', 'bot_a.md')))
    assert.ok(fs.existsSync(path.join(root, 'conversations', 'bot_b.md')))
  })

  it('sanitises unsafe teammate ids into safe file names', () => {
    const root = makeRoot()
    const vault = createVault({ root })
    vault.recordTurn({ role: 'user', text: 'x', botId: '../../etc/passwd', botName: 'Evil' })
    const files = fs.readdirSync(path.join(root, 'raw'))
    assert.equal(files.length, 1)
    assert.ok(!files[0].includes('/'))
    assert.ok(!files[0].includes('..'))
  })
})

// ── recall ────────────────────────────────────────────────────────────────────

describe('vault — recall', () => {
  it('finds a past turn matching the query', () => {
    const vault = createVault({ root: makeRoot() })
    vault.recordTurn({ role: 'user', text: 'the offsite budget is five thousand dollars', botId: 'b1', botName: 'Chief' })
    vault.recordTurn({ role: 'user', text: 'unrelated note about coffee beans', botId: 'b1', botName: 'Chief' })

    const hits = vault.recall('what is the offsite budget')
    assert.ok(hits.length > 0)
    assert.match(hits[0].text, /offsite budget/)
  })

  it('recalls conversations from other teammates too', () => {
    const vault = createVault({ root: makeRoot() })
    vault.recordTurn({ role: 'user', text: 'renew the acme contract in march', botId: 'scout', botName: 'Scout' })
    const hits = vault.recall('acme contract', { botId: 'chief' })
    assert.ok(hits.some((h) => h.botId === 'scout'))
  })

  it('honours the excluded ids so a prompt does not echo its own question', () => {
    const vault = createVault({ root: makeRoot() })
    const turn = vault.recordTurn({
      id: 'ask_1',
      role: 'user',
      text: 'delete the outbound list tonight',
      botId: 'b1',
      botName: 'One',
    })
    assert.ok(turn)
    assert.equal(vault.recall('delete the outbound list', { excludeIds: ['ask_1'] }).length, 0)
  })

  it('returns most-recent turns when the query has no content words', () => {
    const vault = createVault({ root: makeRoot() })
    vault.recordTurn({ role: 'user', text: 'first thing', botId: 'b1', botName: 'One' })
    vault.recordTurn({ role: 'user', text: 'second thing', botId: 'b1', botName: 'One' })
    const hits = vault.recall('', { botId: 'b1' })
    assert.ok(hits.length > 0)
    assert.equal(hits[0].text, 'second thing')
  })
})

// ── profile + context ─────────────────────────────────────────────────────────

describe('vault — profile and context block', () => {
  it('renders profile.md from durable facts', () => {
    const root = makeRoot()
    const vault = createVault({ root })
    vault.syncProfile([
      { id: 'f1', key: 'tone', value: 'prefers short emails', createdAt: 1, updatedAt: 1 },
      { id: 'f2', key: 'deadline', value: 'ships on Fridays', botId: 'bot_a', createdAt: 1, updatedAt: 1 },
    ])
    const md = read(path.join(root, 'profile.md'))
    assert.match(md, /prefers short emails/)
    assert.match(md, /ships on Fridays/)
    assert.match(md, /Notes from teammates/)
  })

  it('folds remembered facts and recalled excerpts into the context block', () => {
    const vault = createVault({ root: makeRoot() })
    vault.syncProfile([{ id: 'f1', key: 'timezone', value: 'GMT+5:30', createdAt: 1, updatedAt: 1 }])
    vault.recordTurn({ role: 'user', text: 'the quarterly review is next tuesday', botId: 'b1', botName: 'Chief' })

    const block = vault.contextBlock('b1', 'when is the quarterly review')
    assert.match(block, /Things you remember about this user/)
    assert.match(block, /GMT\+5:30/)
    assert.match(block, /Excerpts recalled from earlier conversations/)
    assert.match(block, /quarterly review/)
  })

  it('returns an empty block when there is nothing to recall', () => {
    const vault = createVault({ root: makeRoot() })
    assert.equal(vault.contextBlock('b1', 'anything at all'), '')
  })
})

// ── persistence ───────────────────────────────────────────────────────────────

describe('vault — persistence', () => {
  it('reloads recorded turns from raw transcripts on a new instance', () => {
    const root = makeRoot()
    const first = createVault({ root })
    first.recordTurn({ role: 'user', text: 'remember the launch codename is falcon', botId: 'b1', botName: 'Chief' })

    const second = createVault({ root })
    const hits = second.recall('what is the launch codename')
    assert.ok(hits.some((h) => /falcon/.test(h.text)))
    assert.equal(second.hasTurn(first.turns()[0].id), true)
  })

  it('records a log note for events like a cleared thread', () => {
    const root = makeRoot()
    const vault = createVault({ root })
    vault.note('thread.cleared', 'Thread cleared for Chief', { id: 'b1', name: 'Chief' })
    assert.match(read(path.join(root, 'log.md')), /thread\.cleared \| Chief/)
  })
})

// ── index primitives ──────────────────────────────────────────────────────────

describe('vault — search primitives', () => {
  it('drops stopwords and single characters when tokenizing', () => {
    const tokens = tokenize('The quick brown fox is a 5')
    assert.ok(tokens.includes('quick'))
    assert.ok(tokens.includes('brown'))
    assert.ok(!tokens.includes('the'))
    assert.ok(!tokens.includes('is'))
    assert.ok(!tokens.includes('5'))
  })

  it('ranks a stronger lexical match first', () => {
    const corpus = new VaultCorpus()
    corpus.add({ id: 'a', at: 1, role: 'user', text: 'budget', botId: 'x', botName: 'X' })
    corpus.add({ id: 'b', at: 2, role: 'user', text: 'budget budget forecast plan', botId: 'x', botName: 'X' })
    corpus.add({ id: 'c', at: 3, role: 'user', text: 'totally unrelated', botId: 'x', botName: 'X' })
    const hits = corpus.search('budget', 2)
    assert.equal(hits[0].id, 'b')
    assert.ok(!hits.some((h) => h.id === 'c'))
  })
})

// ── per-user history ──────────────────────────────────────────────────────────

describe('vault — per-user history', () => {
  it('tags a recorded turn with the user and stores it in raw JSONL', () => {
    const root = makeRoot()
    const vault = createVault({ root })
    vault.recordTurn({ role: 'user', text: 'book the venue', botId: 'bot_a', botName: 'Chief', user: 'Mudit' })

    const rec = JSON.parse(read(path.join(root, 'raw', 'bot_a.jsonl')).trim().split('\n')[0]) as { user?: string }
    assert.equal(rec.user, 'Mudit')
    assert.equal(vault.turns()[0].user, 'Mudit')
  })

  it('scopes recall to one user so profiles never bleed together', () => {
    const vault = createVault({ root: makeRoot() })
    vault.recordTurn({ role: 'user', text: 'the offsite budget is five thousand dollars', botId: 'b1', botName: 'Chief', user: 'Mudit' })
    vault.recordTurn({ role: 'user', text: 'the offsite budget is two hundred dollars', botId: 'b1', botName: 'Chief', user: 'Priya' })

    const mudits = vault.recall('offsite budget', { user: 'Mudit' })
    assert.equal(mudits.length, 1)
    assert.match(mudits[0].text, /five thousand/)

    const anyUser = vault.recall('offsite budget')
    assert.equal(anyUser.length, 2)
  })

  it('contextBlock labels the user and recalls only their turns', () => {
    const vault = createVault({ root: makeRoot() })
    vault.recordTurn({ role: 'user', text: 'the quarterly review is next tuesday', botId: 'b1', botName: 'Chief', user: 'Mudit' })
    vault.recordTurn({ role: 'user', text: 'the quarterly review is next friday', botId: 'b1', botName: 'Chief', user: 'Priya' })

    // No durable facts, so only the recalled excerpts block appears.
    const block = vault.contextBlock('b1', 'when is the quarterly review', [], 'Mudit')
    assert.match(block, /tuesday/)
    assert.ok(!block.includes('friday'))
  })

  it('keeps the user across reloads from raw transcripts', () => {
    const root = makeRoot()
    const first = createVault({ root })
    first.recordTurn({ role: 'user', text: 'remember the launch codename is falcon', botId: 'b1', botName: 'Chief', user: 'Mudit' })

    const second = createVault({ root })
    assert.equal(second.turns()[0].user, 'Mudit')
  })
})

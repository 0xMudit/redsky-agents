import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { readJson, writeJsonAtomic, JsonStore } from '../electron/lib/persist'

let tmpDir: string

before(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-persist-')) })
after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

const file = () => path.join(tmpDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.json`)

// ── writeJsonAtomic ──────────────────────────────────────────────────────────

describe('writeJsonAtomic', () => {
  it('writes valid JSON and the file is readable back', () => {
    const f = file()
    writeJsonAtomic(f, { hello: 'world', n: 42 })
    const raw = fs.readFileSync(f, 'utf8')
    assert.deepEqual(JSON.parse(raw), { hello: 'world', n: 42 })
  })

  it('creates parent directories if missing', () => {
    const f = path.join(tmpDir, 'deep', 'nested', 'dir', 'file.json')
    writeJsonAtomic(f, [1, 2, 3])
    assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), [1, 2, 3])
  })

  it('leaves no stray .tmp files after a successful write', () => {
    const f = file()
    writeJsonAtomic(f, { clean: true })
    const siblings = fs.readdirSync(tmpDir).filter((n) => n.endsWith('.tmp'))
    assert.equal(siblings.length, 0)
  })

  it('overwrites an existing file atomically', () => {
    const f = file()
    writeJsonAtomic(f, { v: 1 })
    writeJsonAtomic(f, { v: 2 })
    assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { v: 2 })
  })

  it('serializes arrays, nulls, and nested objects correctly', () => {
    const payload = { arr: [1, null, 'x'], nested: { deep: true } }
    const f = file()
    writeJsonAtomic(f, payload)
    assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), payload)
  })

  it('throws with a descriptive message when the target dir is read-only', () => {
    if (process.platform === 'win32') return // chmod is a no-op on Windows
    const roDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-ro-'))
    fs.chmodSync(roDir, 0o555)
    try {
      assert.throws(
        () => writeJsonAtomic(path.join(roDir, 'out.json'), {}),
        (err: Error) => err.message.includes('red-sky:'),
      )
    } finally {
      fs.chmodSync(roDir, 0o755)
      fs.rmSync(roDir, { recursive: true, force: true })
    }
  })
})

// ── readJson ─────────────────────────────────────────────────────────────────

describe('readJson', () => {
  it('returns parsed content for a valid file', () => {
    const f = file()
    fs.writeFileSync(f, JSON.stringify({ ok: true }))
    assert.deepEqual(readJson(f, null), { ok: true })
  })

  it('returns the fallback for a missing file', () => {
    assert.deepEqual(readJson(path.join(tmpDir, 'missing.json'), { def: 1 }), { def: 1 })
  })

  it('returns the fallback for an empty file', () => {
    const f = file()
    fs.writeFileSync(f, '   ')
    assert.deepEqual(readJson(f, 'fallback'), 'fallback')
  })

  it('returns the fallback for malformed JSON', () => {
    const f = file()
    fs.writeFileSync(f, '{ not valid json }}}')
    assert.deepEqual(readJson(f, []), [])
  })

  it('returns the fallback when the file is truncated mid-write', () => {
    const f = file()
    fs.writeFileSync(f, '{"truncated":')
    assert.deepEqual(readJson(f, null), null)
  })
})

// ── JsonStore ─────────────────────────────────────────────────────────────────

describe('JsonStore', () => {
  it('round-trips a write and read', () => {
    const store = new JsonStore<{ x: number }>(file(), { x: 0 })
    store.write({ x: 99 })
    assert.equal(store.read().x, 99)
  })

  it('returns the fallback on first read of a non-existent file', () => {
    const store = new JsonStore<string[]>(path.join(tmpDir, 'new.json'), ['default'])
    assert.deepEqual(store.read(), ['default'])
  })

  it('persists across separate store instances pointing at the same file', () => {
    const f = file()
    new JsonStore<number>(f, 0).write(123)
    assert.equal(new JsonStore<number>(f, 0).read(), 123)
  })

  it('handles concurrent sequential writes without corruption', () => {
    const f = file()
    const store = new JsonStore<number[]>(f, [])
    for (let i = 0; i < 20; i++) store.write([i])
    assert.deepEqual(store.read(), [19])
  })
})

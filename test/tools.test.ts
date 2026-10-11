import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { after, describe, it } from 'node:test'
import { readFile, writeFile, runShell } from '../electron/tools'
import { workspaceDir } from '../electron/paths'
import { cleanupTempHomes, useTempHome } from './helpers'

after(cleanupTempHomes)

// Each test suite section calls useTempHome() once at the top of its first test
// and re-reads workspaceDir() lazily so it always picks up the current env var.

// ── writeFile — sandbox guard ─────────────────────────────────────────────────

describe('tools.writeFile — sandbox guard', () => {
  it('writes a file inside the workspace', async () => {
    const ws = useTempHome()
    fs.mkdirSync(path.join(ws, 'logs'), { recursive: true })
    const result = await writeFile('test-output.txt', 'hello sandbox')
    assert.equal(result.ok, true)
    assert.match(result.output ?? '', /test-output\.txt/)
    assert.equal(fs.readFileSync(path.join(workspaceDir(), 'test-output.txt'), 'utf8'), 'hello sandbox')
  })

  it('creates nested directories automatically', async () => {
    const result = await writeFile('sub/dir/file.txt', 'nested')
    assert.equal(result.ok, true)
    assert.ok(fs.existsSync(path.join(workspaceDir(), 'sub', 'dir', 'file.txt')))
  })

  it('blocks ../ path traversal', async () => {
    const result = await writeFile('../escape.txt', 'bad')
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /escapes workspace/)
  })

  it('blocks absolute paths', async () => {
    const absPath = process.platform === 'win32' ? 'C:\\Windows\\evil.txt' : '/etc/evil.txt'
    const result = await writeFile(absPath, 'bad')
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /escapes workspace/)
  })

  it('blocks sibling-directory traversal (workspace-evil style)', async () => {
    const result = await writeFile('../workspace-evil/file.txt', 'bad')
    assert.equal(result.ok, false)
  })
})

// ── readFile — sandbox guard ──────────────────────────────────────────────────

describe('tools.readFile — sandbox guard', () => {
  it('reads a file inside the workspace', async () => {
    useTempHome()
    fs.mkdirSync(path.join(workspaceDir(), 'logs'), { recursive: true })
    fs.writeFileSync(path.join(workspaceDir(), 'readable.txt'), 'readable content')
    const result = await readFile('readable.txt')
    assert.equal(result.ok, true)
    assert.equal(result.output, 'readable content')
  })

  it('returns ok=false for a missing file (not a throw)', async () => {
    const result = await readFile('does-not-exist.txt')
    assert.equal(result.ok, false)
    assert.ok(result.error)
  })

  it('blocks ../ path traversal', async () => {
    const result = await readFile('../../package.json')
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /escapes workspace/)
  })
})

// ── runShell — dangerous command filter ───────────────────────────────────────

describe('tools.runShell — dangerous command filter', () => {
  const BLOCKED = [
    'rm -rf /',
    'rm -rf /home',
    'format c:',
    'diskpart',
    'rd /s /q c:\\',
  ]

  for (const cmd of BLOCKED) {
    it(`blocks: ${cmd}`, async () => {
      useTempHome()
      const result = await runShell(cmd)
      assert.equal(result.ok, false)
      assert.match(result.error ?? '', /blocked/)
    })
  }

  it('allows a safe command (echo)', async () => {
    useTempHome()
    const result = await runShell('echo hello')
    assert.equal(result.ok, true)
    assert.match(result.output ?? '', /hello/)
  })

  it('returns ok=false and non-zero code for a failing command', async () => {
    useTempHome()
    const cmd = process.platform === 'win32' ? 'cmd /c exit 1' : 'sh -c "exit 1"'
    const result = await runShell(cmd)
    assert.equal(result.ok, false)
    assert.ok((result.code ?? 0) !== 0)
  })
})

// ── runShell — timeout ────────────────────────────────────────────────────────

describe('tools.runShell — timeout', () => {
  it('kills a long-running command after timeoutMs', async () => {
    useTempHome()
    const cmd = `node -e "setTimeout(() => {}, 30000)"`
    const start = Date.now()
    const result = await runShell(cmd, { timeoutMs: 400 })
    const elapsed = Date.now() - start
    assert.equal(result.ok, false)
    assert.match(result.output ?? '', /timed out/)
    assert.ok(elapsed < 5000, `took ${elapsed}ms — should be < 5000`)
  })
})

// ── Load test — 50 concurrent readFile / writeFile calls ─────────────────────

describe('tools — load test: 50 concurrent reads', () => {
  it('handles 50 concurrent readFile calls without error or corruption', async () => {
    useTempHome()
    fs.mkdirSync(path.join(workspaceDir(), 'logs'), { recursive: true })
    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(path.join(workspaceDir(), `load-${i}.txt`), `content-${i}`)
    }
    const tasks = Array.from({ length: 50 }, (_, i) => readFile(`load-${i % 10}.txt`))
    const results = await Promise.all(tasks)
    const failed = results.filter((r) => !r.ok)
    assert.equal(failed.length, 0, `${failed.length} reads failed`)
    for (let i = 0; i < 50; i++) {
      assert.equal(results[i].output, `content-${i % 10}`, `result[${i}] mismatch`)
    }
  })

  it('handles 50 concurrent writeFile calls without corruption', async () => {
    const ws = useTempHome()
    fs.mkdirSync(path.join(ws, 'logs'), { recursive: true })
    const tasks = Array.from({ length: 50 }, (_, i) =>
      writeFile(`concurrent-${i}.txt`, `value-${i}`),
    )
    const results = await Promise.all(tasks)
    const failed = results.filter((r) => !r.ok)
    assert.equal(failed.length, 0)
    for (let i = 0; i < 50; i++) {
      const content = fs.readFileSync(path.join(workspaceDir(), `concurrent-${i}.txt`), 'utf8')
      assert.equal(content, `value-${i}`)
    }
  })
})

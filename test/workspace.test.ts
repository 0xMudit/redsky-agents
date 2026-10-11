import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { after, describe, it } from 'node:test'
import { snapshotWorkspace, diffSnaps, searchWorkspaceFiles, importDroppedFiles } from '../electron/workspace'
import { workspaceDir } from '../electron/paths'
import { cleanupTempHomes, useTempHome } from './helpers'

after(cleanupTempHomes)

// ── snapshotWorkspace ─────────────────────────────────────────────────────────
// These tests operate on isolated temp dirs passed directly to snapshotWorkspace()
// so they are completely independent of REDSKY_TEST_HOME.

describe('snapshotWorkspace', () => {
  it('returns an empty array for an empty workspace', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-ws-snap-'))
    try {
      assert.equal(snapshotWorkspace(dir).length, 0)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('finds files recursively', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-ws-snap-'))
    try {
      fs.writeFileSync(path.join(dir, 'a.txt'), 'a')
      fs.mkdirSync(path.join(dir, 'sub'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'sub', 'b.txt'), 'b')
      const snaps = snapshotWorkspace(dir)
      assert.ok(snaps.some((s) => s.rel === 'a.txt'))
      assert.ok(snaps.some((s) => s.rel === 'sub/b.txt'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips logs/, node_modules/, .git/, dist/', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-ws-snap-'))
    try {
      for (const skip of ['logs', 'node_modules', '.git', 'dist']) {
        fs.mkdirSync(path.join(dir, skip), { recursive: true })
        fs.writeFileSync(path.join(dir, skip, 'file.txt'), 'x')
      }
      fs.writeFileSync(path.join(dir, 'keep.txt'), 'y')
      const snaps = snapshotWorkspace(dir)
      assert.ok(snaps.every((s) => !s.rel.startsWith('logs/')))
      assert.ok(snaps.every((s) => !s.rel.startsWith('node_modules/')))
      assert.ok(snaps.some((s) => s.rel === 'keep.txt'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses forward slashes in rel paths', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-ws-snap-'))
    try {
      fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'a', 'b', 'c.txt'), 'x')
      const snaps = snapshotWorkspace(dir)
      assert.ok(snaps.every((s) => !s.rel.includes('\\')))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── diffSnaps ─────────────────────────────────────────────────────────────────

describe('diffSnaps', () => {
  const snap = (rel: string, size = 10, mtime = 1000) => ({ rel, size, mtime })

  it('detects added files', () => {
    const diff = diffSnaps([], [snap('new.txt')])
    assert.deepEqual(diff.added, ['new.txt'])
    assert.deepEqual(diff.changed, [])
    assert.deepEqual(diff.removed, [])
  })

  it('detects removed files', () => {
    const diff = diffSnaps([snap('old.txt')], [])
    assert.deepEqual(diff.removed, ['old.txt'])
    assert.deepEqual(diff.added, [])
  })

  it('detects changed files by size', () => {
    const diff = diffSnaps([snap('f.txt', 10)], [snap('f.txt', 20)])
    assert.deepEqual(diff.changed, ['f.txt'])
  })

  it('detects changed files by mtime (>2ms delta)', () => {
    const diff = diffSnaps([snap('f.txt', 10, 1000)], [snap('f.txt', 10, 1005)])
    assert.deepEqual(diff.changed, ['f.txt'])
  })

  it('does not flag files with identical size and near-identical mtime (≤2ms)', () => {
    const diff = diffSnaps([snap('f.txt', 10, 1000)], [snap('f.txt', 10, 1001)])
    assert.deepEqual(diff.changed, [])
  })

  it('caps each bucket at 40 entries', () => {
    const before = Array.from({ length: 50 }, (_, i) => snap(`f${i}.txt`))
    const diff = diffSnaps(before, [])
    assert.ok(diff.removed.length <= 40)
  })

  it('handles empty before and after', () => {
    const diff = diffSnaps([], [])
    assert.equal(diff.added.length, 0)
    assert.equal(diff.changed.length, 0)
    assert.equal(diff.removed.length, 0)
  })
})

// ── searchWorkspaceFiles ──────────────────────────────────────────────────────
// These tests point REDSKY_TEST_HOME at a dedicated temp dir so searchWorkspaceFiles
// (which calls snapshotWorkspace() with workspaceDir() as root) finds our files.

describe('searchWorkspaceFiles', () => {
  it('returns empty for empty query', () => {
    useTempHome()
    assert.equal(searchWorkspaceFiles('').length, 0)
  })

  it('finds files by name match', () => {
    useTempHome()
    fs.writeFileSync(path.join(workspaceDir(), 'report.md'), '# Report')
    const hits = searchWorkspaceFiles('report')
    assert.ok(hits.some((h) => h.title.includes('report')))
  })

  it('finds files by content match', () => {
    useTempHome()
    fs.writeFileSync(path.join(workspaceDir(), 'notes.txt'), 'budget review for Q4')
    const hits = searchWorkspaceFiles('budget review')
    assert.ok(hits.some((h) => h.snippet.includes('budget')))
  })

  it('respects the limit parameter', () => {
    useTempHome()
    for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(workspaceDir(), `item${i}.md`), 'searchable content xyz')
    const hits = searchWorkspaceFiles('searchable', 5)
    assert.ok(hits.length <= 5)
  })

  it('returns hits with id, kind=file, title, snippet, path', () => {
    useTempHome()
    fs.writeFileSync(path.join(workspaceDir(), 'check.md'), 'unique_marker_abc')
    const hits = searchWorkspaceFiles('unique_marker_abc')
    assert.ok(hits.length > 0)
    assert.equal(hits[0].kind, 'file')
    assert.ok(hits[0].id)
    assert.ok(hits[0].title)
    assert.ok(hits[0].path)
  })
})

// ── importDroppedFiles ────────────────────────────────────────────────────────

describe('importDroppedFiles', () => {
  it('writes files to workspace/inbox/ and returns relative paths', () => {
    useTempHome()
    const paths = importDroppedFiles([{ name: 'hello.txt', data: Buffer.from('hello world') }])
    assert.equal(paths.length, 1)
    assert.match(paths[0], /inbox[/\\].*hello\.txt$/)
    // The drop lands in workspaceDir(), which is <userData>/workspace under useTempHome().
    const abs = path.join(workspaceDir(), paths[0].replace(/\//g, path.sep))
    assert.equal(fs.readFileSync(abs, 'utf8'), 'hello world')
  })

  it('sanitizes dangerous filename characters', () => {
    useTempHome()
    const paths = importDroppedFiles([{ name: '../../../etc/passwd', data: Buffer.from('x') }])
    assert.ok(paths[0].startsWith('inbox'))
  })

  it('handles multiple files at once', () => {
    useTempHome()
    const paths = importDroppedFiles([
      { name: 'a.txt', data: Buffer.from('A') },
      { name: 'b.txt', data: Buffer.from('B') },
    ])
    assert.equal(paths.length, 2)
  })
})

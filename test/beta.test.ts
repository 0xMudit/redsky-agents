import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { after, describe, it } from 'node:test'
import { checkOpenCode, composeFeedbackUrl, redactedLogTail } from '../electron/beta'
import { logsDir } from '../electron/paths'
import { cleanupTempHomes, useTempHome } from './helpers'

describe('checkOpenCode', () => {
  const originalPath = process.env.PATH
  const foundDir = fs.mkdtempSync(path.join(os.tmpdir(), 'red-sky-path-'))
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'red-sky-empty-'))

  after(() => {
    process.env.PATH = originalPath
    fs.rmSync(foundDir, { recursive: true, force: true })
    fs.rmSync(emptyDir, { recursive: true, force: true })
  })

  it('finds the CLI when an executable is on PATH', () => {
    const name = process.platform === 'win32' ? 'opencode.cmd' : 'opencode'
    fs.writeFileSync(path.join(foundDir, name), '')
    process.env.PATH = foundDir
    const result = checkOpenCode()
    assert.equal(result.found, true)
    assert.equal(result.path, path.join(foundDir, name))
  })

  it('reports not-found when PATH has no CLI', () => {
    process.env.PATH = emptyDir
    assert.equal(checkOpenCode().found, false)
  })
})

describe('composeFeedbackUrl', () => {
  it('builds a prefilled GitHub issue without leaking the raw secret', () => {
    const url = new URL(
      composeFeedbackUrl({
        appVersion: '0.2.0',
        platform: 'win32',
        status: 'online',
        opencode: { found: true, path: 'C:/bin/opencode.cmd' },
        models: 2,
        bots: 3,
        routines: 1,
        memories: 4,
        logTailRedacted: '[redacted log line]',
      }),
    )
    assert.equal(url.hostname, 'github.com')
    assert.equal(url.searchParams.get('labels'), 'beta-feedback')
    const body = url.searchParams.get('body') ?? ''
    assert.match(body, /App: 0\.2\.0 · win32/)
    assert.match(body, /OpenCode CLI on PATH: yes/)
    assert.doesNotMatch(body, /sk-live-|Bearer\s+realtoken/i)
  })
})

describe('redactedLogTail', () => {
  after(cleanupTempHomes)

  it('drops secret-shaped lines and trims long tokens', () => {
    useTempHome()
    fs.writeFileSync(
      path.join(logsDir(), 'app.ndjson'),
      ['{"msg":"boot ok"}', '{"apiKey":"sk-live-abcdefghijklmnopqrstuvwxyz"}', `{"blob":"${'a'.repeat(40)}"}`].join('\n'),
    )
    const tail = redactedLogTail()
    assert.match(tail, /boot ok/)
    assert.doesNotMatch(tail, /sk-live-/)
    assert.match(tail, /\[redacted\]/)
  })

  it('returns a placeholder when no log exists', () => {
    useTempHome()
    assert.equal(redactedLogTail(), '(no run logs yet)')
  })
})

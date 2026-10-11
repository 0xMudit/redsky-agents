import * as fs from 'node:fs'
import * as path from 'node:path'
import { logsDir } from './paths'

const ISSUE_URL = 'https://github.com/0xMudit/redsky-agents/issues/new'

export interface OpenCodeCheck {
  found: boolean
  path?: string
}

/** Walk PATH rather than spawning a shell — cross-platform and side-effect free. */
export function checkOpenCode(): OpenCodeCheck {
  const names = process.platform === 'win32' ? ['opencode.exe', 'opencode.cmd', 'opencode'] : ['opencode']
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      try {
        if (fs.statSync(candidate).isFile()) return { found: true, path: candidate }
      } catch {
        /* not in this dir */
      }
    }
  }
  return { found: false }
}

const SECRET_SHAPED = /(api[_-]?key|secret|token|password|bearer|authorization)/i
const LONG_TOKEN_VALUE = /([A-Za-z0-9_/=+.-]{28,})/g

/** Last N lines of the run log with secret-shaped values scrubbed before they leave the machine. */
export function redactedLogTail(n = 60): string {
  const file = path.join(logsDir(), 'app.ndjson')
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const lines = raw.split('\n').filter(Boolean).slice(-n)
    return lines
      .map((line) => {
        if (SECRET_SHAPED.test(line)) return '[redacted log line]'
        return line.replace(LONG_TOKEN_VALUE, '[redacted]')
      })
      .join('\n')
  } catch {
    return '(no run logs yet)'
  }
}

export interface FeedbackInput {
  appVersion: string
  platform: string
  status: string
  opencode: OpenCodeCheck
  models: number
  bots: number
  routines: number
  memories: number
  logTailRedacted: string
}

export function composeFeedbackUrl(input: FeedbackInput): string {
  const body = [
    '> Autofilled by Red Sky. Trim anything you do not want public before submitting.',
    '',
    '**What happened?**',
    '',
    '**What did you expect?**',
    '',
    '**Steps to reproduce**',
    '',
    '---',
    '',
    '```text',
    `App: ${input.appVersion ?? 'dev'} · ${input.platform}`,
    `Status: ${input.status}`,
    `OpenCode CLI on PATH: ${input.opencode.found ? 'yes' : 'no'}${input.opencode.path ? ` (${input.opencode.path})` : ''}`,
    `Models configured: ${input.models}`,
    `Bots: ${input.bots} · Routines: ${input.routines} · Memories: ${input.memories}`,
    '',
    'Log tail (redacted):',
    input.logTailRedacted || '(none)',
    '```',
  ].join('\n')

  const url = new URL(ISSUE_URL)
  url.searchParams.set('title', 'Beta feedback — ')
  url.searchParams.set('labels', 'beta-feedback')
  url.searchParams.set('body', body)
  return url.toString()
}
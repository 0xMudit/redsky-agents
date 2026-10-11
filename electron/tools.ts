import { execFileSync, spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { workspaceDir, logsDir } from './paths'

/**
 * Phase 1 tools — sandboxed to the Red Sky workspace dir.
 * Every call is logged to workspace/logs/tools.ndjson with timestamp + in/out.
 * (opencode's own agent additionally uses its native tools inside this same workspace.)
 */

export interface ToolResult {
  ok: boolean
  output?: string
  error?: string
  code?: number
}

interface ToolCallLog {
  ts: number
  tool: string
  input: unknown
  output: string
  error?: string
}

function assertInside(rel: string): { abs: string; relNorm: string } {
  const relNorm = path.normalize(rel).replace(/^[/\\]+/, '')
  const root = path.resolve(workspaceDir())
  const abs = path.resolve(root, relNorm)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`path escapes workspace/ (blocked): ${rel}`)
  }
  return { abs, relNorm }
}

async function logCall(entry: ToolCallLog): Promise<void> {
  try {
    const file = path.join(logsDir(), 'tools.ndjson')
    await fs.appendFile(file, JSON.stringify(entry) + '\n', 'utf8')
  } catch {
    /* logging must never break a tool call */
  }
}

export async function readFile(rel: string): Promise<ToolResult> {
  try {
    const { abs } = assertInside(rel)
    const out = await fs.readFile(abs, 'utf8')
    await logCall({ ts: Date.now(), tool: 'read_file', input: rel, output: out })
    return { ok: true, output: out }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function writeFile(rel: string, content: string): Promise<ToolResult> {
  try {
    const { abs, relNorm } = assertInside(rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf8')
    await logCall({ ts: Date.now(), tool: 'write_file', input: { rel: relNorm, bytes: content.length }, output: `wrote ${relNorm}` })
    return { ok: true, output: `wrote ${relNorm}` }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

const DANGEROUS = [
  /\brm\s+-rf\s+\/?\s*(?:\/|\\|$)/i,
  /\bexpand-archive\b.*(?:c:\\|c:\\\\|a:\\).*\{x-risky/i,
  /^\s*(format|diskpart)\b/i,
  /\b(format|diskpart)\b/i,
  /\brd\s+\/s\s+\/?\s*q?.*(?:[a-z]:\\|\/)(?:\s)*(?:\/|\\|$)/i,
]

export function runShell(command: string, opts?: { timeoutMs?: number }): Promise<ToolResult> {
  const timeoutMs = opts?.timeoutMs ?? 60_000
  return new Promise((resolve) => {
    const blocked = DANGEROUS.some((re) => re.test(command))
    if (blocked) {
      void logCall({ ts: Date.now(), tool: 'run_shell', input: command, output: '', error: 'blocked by red-sky safety filter' })
      resolve({ ok: false, error: 'blocked by red-sky safety filter (destructive command)' })
      return
    }

    const win = process.platform === 'win32'
    const shell = win
      ? { file: 'cmd.exe', args: ['/d', '/s', '/c', command] }
      : { file: '/bin/sh', args: ['-c', command] }

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const proc = spawn(shell.file, shell.args, {
      cwd: workspaceDir(),
      windowsHide: true,
      env: { ...process.env },
      // On Windows libuv re-quotes each argument, which mangles embedded quotes
      // (e.g. `node -e "..."`). Hand the command to cmd.exe untouched instead.
      windowsVerbatimArguments: win,
    })

    const settle = (result: ToolResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const killTree = (): void => {
      if (win && proc.pid) {
        try {
          execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
          return
        } catch {
          /* fall through to a plain kill */
        }
      }
      try {
        proc.kill()
      } catch {
        /* already gone */
      }
    }

    const timer = setTimeout(() => {
      timedOut = true
      killTree()
      // Resolve on the timer rather than waiting for 'close': a grandchild can
      // inherit the stdio pipes and keep them open, so 'close' may never fire.
      const out = [stdout.trim(), `(timed out after ${timeoutMs}ms)`, stderr.trim()].filter(Boolean).join('\n')
      void logCall({ ts: Date.now(), tool: 'run_shell', input: command, output: out, error: `timed out after ${timeoutMs}ms` })
      settle({ ok: false, output: out, code: -1 })
    }, timeoutMs)

    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')))
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')))
    proc.on('error', (err) => {
      void logCall({ ts: Date.now(), tool: 'run_shell', input: command, output: stdout, error: err.message })
      settle({ ok: false, error: err.message })
    })
    proc.on('close', (code) => {
      if (timedOut) return
      const out = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
      void logCall({ ts: Date.now(), tool: 'run_shell', input: command, output: out, error: code !== 0 ? `exit ${code}` : undefined })
      settle({ ok: code === 0, output: out || '(no output)', code: code ?? -1 })
    })
  })
}

export const tools = { readFile, writeFile, runShell }
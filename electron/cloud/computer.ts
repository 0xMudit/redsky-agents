import * as fs from 'node:fs'
import * as path from 'node:path'
import { JsonStore } from '../lib/persist'
import { workspaceDir } from '../paths'
import type { CloudComputer, ComputerState } from '../../shared/cloud'

/**
 * Feature 1 — a persistent computer every bot owns.
 *
 * Each bot gets its own directory under `workspace/.computers/<botId>` so its
 * files, scratch space, and saved logins survive between runs and are kept
 * apart from the user's shared workspace. This is deliberately modelled on a
 * machine, not a session: `stop` powers it down without deleting it, and a
 * stopped computer comes back with its contents intact.
 *
 * The credential vault is intentionally thin here — a label per saved login,
 * never the secret itself. Wiring it to a real OS keychain (or a hosted
 * secret store) is the assignment; see docs/FEATURES-CLOUD.md.
 */

/** The persisted slice — `root` is derived from the workspace, not stored. */
interface ComputerRecord {
  botId: string
  state: ComputerState
  credentials: string[]
  createdAt: number
  updatedAt: number
}

export interface ComputerStore {
  list: () => CloudComputer[]
  get: (botId: string) => CloudComputer | undefined
  /** Provision (or return) the bot's computer, creating its directory. */
  ensure: (botId: string) => CloudComputer
  stop: (botId: string) => CloudComputer
  /** Persist a login label for the bot; the secret value is never stored here. */
  addCredential: (botId: string, label: string) => CloudComputer
  /** Flush any pending debounced write immediately. Call on app.before-quit. */
  flush: () => void
}

function computerRoot(botId: string): string {
  return path.join(workspaceDir(), '.computers', botId)
}

export function createComputerStore(): ComputerStore {
  const db = new JsonStore<ComputerRecord[]>(path.join(workspaceDir(), 'computers.json'), [])
  let rows = db.read()
  const persist = () => db.write(rows)

  const view = (row: ComputerRecord): CloudComputer => ({
    botId: row.botId,
    state: row.state,
    root: computerRoot(row.botId),
    credentialCount: row.credentials.length,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })

  function ensure(botId: string): CloudComputer {
    if (!botId.trim()) throw new Error('bot id required')
    const now = Date.now()
    let row = rows.find((r) => r.botId === botId)
    if (!row) {
      row = { botId, state: 'ready', credentials: [], createdAt: now, updatedAt: now }
      rows.push(row)
      persist()
    }
    // Provisioning is idempotent: make sure the directory exists and the
    // record reflects that the computer is up.
    fs.mkdirSync(computerRoot(botId), { recursive: true })
    if (row.state !== 'ready') {
      row.state = 'ready'
      row.updatedAt = now
      persist()
    }
    return view(row)
  }

  return {
    list: () => rows.map(view),
    get: (botId) => {
      const row = rows.find((r) => r.botId === botId)
      return row ? view(row) : undefined
    },
    ensure,
    stop(botId) {
      const row = rows.find((r) => r.botId === botId)
      if (!row) throw new Error(`no computer for bot ${botId}`)
      row.state = 'stopped'
      row.updatedAt = Date.now()
      persist()
      return view(row)
    },
    addCredential(botId, label) {
      ensure(botId)
      const row = rows.find((r) => r.botId === botId)!
      const clean = label.trim().slice(0, 80)
      if (clean && !row.credentials.includes(clean)) {
        row.credentials.push(clean)
        row.updatedAt = Date.now()
        persist()
      }
      return view(row)
    },
    flush: () => db.flush(),
  }
}

import * as path from 'node:path'
import { JsonStore } from '../lib/persist'
import { newId } from '../lib/ids'
import { userDataDir } from '../paths'
import type { Handoff, HandoffState } from '../../shared/cloud'

/**
 * Feature 8 — bot-to-bot handoffs, as a durable queue.
 *
 * Today a handoff happens inline: `collab.ts` parses an `@Name` mention and the
 * sending agent fires the prompt at the target in the same run. That is fine
 * while both bots live in one process, but it leaves no record and cannot
 * survive a restart. This store makes the handoff a first-class object with a
 * lifecycle (`queued → accepted → done | failed`), so a hosted receiver can pick
 * it up later and the UI can show what was passed and whether it landed.
 *
 * This is also the seam for feature 4 (multi-bot collaboration): a room's work
 * is just a stream of handoffs between its participants.
 */
/**
 * Loop protection for auto-dispatch. True when a handoff is still in flight
 * (queued or accepted) that would make `fromBotId → toBotId` a reciprocal
 * A→B→A cycle. Pure, so the guard is testable without a store.
 */
export function reciprocalInFlight(rows: Handoff[], fromBotId: string, toBotId: string): boolean {
  return rows.some(
    (h) => (h.state === 'queued' || h.state === 'accepted') && h.fromBotId === toBotId && h.toBotId === fromBotId,
  )
}

export interface HandoffStore {
  list: (botId?: string) => Handoff[]
  get: (id: string) => Handoff | undefined
  queue: (payload: { fromBotId: string; toBotId: string; prompt: string }) => Handoff
  transition: (id: string, state: HandoffState, note?: string) => Handoff
  /** Flush any pending debounced write immediately. Call on app.before-quit. */
  flush: () => void
}

export function createHandoffStore(): HandoffStore {
  const db = new JsonStore<Handoff[]>(path.join(userDataDir(), 'handoffs.json'), [])
  let rows = db.read()
  const persist = () => db.write(rows)

  const clone = (h: Handoff): Handoff => ({ ...h })
  const find = (id: string): Handoff | undefined => rows.find((h) => h.id === id)

  return {
    // A bot's inbox is everything sent to it plus everything it sent.
    list: (botId) => rows.filter((h) => !botId || h.fromBotId === botId || h.toBotId === botId).map(clone),
    get: (id) => {
      const row = find(id)
      return row ? clone(row) : undefined
    },
    queue({ fromBotId, toBotId, prompt }) {
      if (!fromBotId || !toBotId) throw new Error('from and to bots are required')
      if (fromBotId === toBotId) throw new Error('a bot cannot hand off to itself')
      if (!prompt.trim()) throw new Error('handoff prompt required')
      const now = Date.now()
      const row: Handoff = {
        id: newId('handoff'),
        fromBotId,
        toBotId,
        prompt: prompt.trim(),
        state: 'queued',
        createdAt: now,
        updatedAt: now,
      }
      rows.push(row)
      persist()
      return clone(row)
    },
    transition(id, state, note) {
      const row = find(id)
      if (!row) throw new Error(`unknown handoff: ${id}`)
      row.state = state
      if (note !== undefined) row.note = note
      row.updatedAt = Date.now()
      persist()
      return clone(row)
    },
    flush: () => db.flush(),
  }
}

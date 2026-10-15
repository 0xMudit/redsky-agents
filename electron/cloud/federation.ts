import * as path from 'node:path'
import { JsonStore } from '../lib/persist'
import { newId } from '../lib/ids'
import { userDataDir } from '../paths'
import type { FederatedFact } from '../../shared/cloud'

/**
 * Feature 7 — cross-bot learning.
 *
 * `memory.ts` already harvests durable facts, but they belong to one bot. This
 * is the shared layer above it: a fact can be published so every bot — or only
 * a chosen few — can recall it. `visibleTo` is the read rule, kept pure so the
 * sharing semantics can be tested without a store: a fact with no `sharedWith`
 * is public to the fleet, and a fact is always visible to the bot that learned
 * it.
 */
export interface FederationStore {
  list: (botId?: string) => FederatedFact[]
  /** Facts a given bot may recall. */
  visibleTo: (botId: string) => FederatedFact[]
  publish: (payload: { key: string; value: string; sourceBotId?: string; sharedWith?: string[] }) => FederatedFact
  forget: (id: string) => void
  /** Flush any pending debounced write immediately. Call on app.before-quit. */
  flush: () => void
}

/** Pure visibility rule — see the module comment. */
export function factVisibleTo(fact: Pick<FederatedFact, 'sourceBotId' | 'sharedWith'>, botId: string): boolean {
  if (fact.sourceBotId === botId) return true
  if (!fact.sharedWith || fact.sharedWith.length === 0) return true
  return fact.sharedWith.includes(botId)
}

export function createFederationStore(): FederationStore {
  const db = new JsonStore<FederatedFact[]>(path.join(userDataDir(), 'federated.json'), [])
  let rows = db.read()
  const persist = () => db.write(rows)

  return {
    list: (botId) => (botId ? rows.filter((r) => factVisibleTo(r, botId)) : rows).map((r) => ({ ...r })),
    visibleTo: (botId) => rows.filter((r) => factVisibleTo(r, botId)).map((r) => ({ ...r })),
    publish({ key, value, sourceBotId, sharedWith }) {
      const cleanKey = key.trim()
      const cleanValue = value.trim()
      if (!cleanKey || !cleanValue) throw new Error('key and value required')
      const now = Date.now()
      // One fact per (key, source); re-publishing updates in place rather than
      // piling up duplicates.
      const existing = rows.find((r) => r.key === cleanKey && r.sourceBotId === sourceBotId)
      if (existing) {
        existing.value = cleanValue
        existing.sharedWith = sharedWith
        existing.updatedAt = now
        persist()
        return { ...existing }
      }
      const row: FederatedFact = {
        id: newId('fact'),
        key: cleanKey,
        value: cleanValue,
        sourceBotId,
        sharedWith,
        createdAt: now,
        updatedAt: now,
      }
      rows.push(row)
      persist()
      return { ...row }
    },
    forget(id) {
      rows = rows.filter((r) => r.id !== id)
      persist()
    },
    flush: () => db.flush(),
  }
}

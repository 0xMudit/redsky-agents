import * as path from 'node:path'
import { JsonStore } from './lib/persist'
import { newId } from './lib/ids'
import { userDataDir } from './paths'
import type { MemoryRow } from '../shared/types'

export type { MemoryRow }

export interface MemoryStore {
  add: (key: string, value: string, botId?: string) => MemoryRow
  list: (botId?: string) => MemoryRow[]
  search: (query: string, k?: number, botId?: string) => MemoryRow[]
  harvestFromText: (text: string, botId?: string) => MemoryRow[]
  remove: (id: string) => void
  clear: () => void
}

const NOTE_RE = /(?:noted for next time|updated memory(?: for [^:\n]+)?)[:\s]+(.+)/gi

/** Count non-overlapping occurrences of `needle` in `hay` (both already lowercased). */
function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let at = hay.indexOf(needle)
  while (at !== -1) {
    count++
    at = hay.indexOf(needle, at + needle.length)
  }
  return count
}

export function extractMemoryLines(text: string): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = []
  const seen = new Set<string>()
  for (const match of text.matchAll(NOTE_RE)) {
    const value = match[1]?.trim()
    if (!value) continue
    const key = value.slice(0, 48).replace(/[.:]+$/, '')
    const sig = `${key}|${value}`
    if (seen.has(sig)) continue
    seen.add(sig)
    out.push({ key, value })
  }
  return out
}

export function createMemoryStore(): MemoryStore {
  const db = new JsonStore<MemoryRow[]>(path.join(userDataDir(), 'memory.json'), [])
  let rows = db.read()
  const persist = () => db.write(rows)
  return {
    add(key, value, botId) {
      const now = Date.now()
      const row: MemoryRow = {
        id: newId('mem'),
        key,
        value,
        botId,
        createdAt: now,
        updatedAt: now,
      }
      rows.push(row)
      persist()
      return row
    },
    list: (botId) =>
      rows
        .map((row, index) => ({ row, index }))
        .filter((x) => !botId || !x.row.botId || x.row.botId === botId)
        .sort((a, b) => b.row.updatedAt - a.row.updatedAt || b.index - a.index)
        .map((x) => x.row),
    search(query, k = 5, botId) {
      const pool = this.list(botId)
      const q = query.toLowerCase().split(/\s+/).filter(Boolean)
      if (!q.length) return pool.slice(0, k)
      return pool
        .map((r) => {
          const hay = `${r.key}\n${r.value}`.toLowerCase()
          // Rank by how often the query words actually appear, so a row that
          // mentions a term four times outranks one that mentions it once.
          const hits = q.reduce((n, w) => n + countOccurrences(hay, w), 0)
          return { r, hits }
        })
        .filter((x) => x.hits > 0)
        .sort((a, b) => b.hits - a.hits)
        .slice(0, k)
        .map((x) => x.r)
    },
    harvestFromText(text, botId) {
      const added: MemoryRow[] = []
      for (const line of extractMemoryLines(text)) {
        added.push(this.add(line.key, line.value, botId))
      }
      return added
    },
    remove(id) {
      rows = rows.filter((r) => r.id !== id)
      persist()
    },
    clear() {
      rows = []
      persist()
    },
  }
}

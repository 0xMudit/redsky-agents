import * as path from 'node:path'
import { JsonStore } from './lib/persist'
import { userDataDir } from './paths'
import type { Connector, ConnectorStatus } from '../shared/types'

export const CONNECTOR_CATALOG: Array<Pick<Connector, 'id' | 'name' | 'description'>> = [
  { id: 'browser', name: 'Browser', description: 'Use sites the way you would, including tools that are harder to navigate.' },
  { id: 'gmail', name: 'Gmail', description: 'Read and draft mail. Sending stays behind Auto Review.' },
  { id: 'calendar', name: 'Calendar', description: 'Look up time and draft events; confirm before booking.' },
  { id: 'slack', name: 'Slack', description: 'Search threads and draft replies across workspaces you connect.' },
  { id: 'github', name: 'GitHub', description: 'Read issues and PRs, then hand coding work to a specialist bot.' },
  { id: 'drive', name: 'Drive', description: 'Search docs and pull context into the workspace.' },
  { id: 'notion', name: 'Notion', description: 'Search wikis and design docs your team already wrote.' },
]

export interface ConnectorStore {
  list: () => Connector[]
  upsert: (id: string, status: ConnectorStatus, note?: string) => Connector
  /** Flush any pending debounced write immediately. Call on app.before-quit. */
  flush: () => void
}

export function createConnectorStore(): ConnectorStore {
  const db = new JsonStore<Record<string, { status: ConnectorStatus; note?: string; updatedAt: number }>>(
    path.join(userDataDir(), 'connectors.json'),
    {},
  )
  const overlay = () => db.read()

  function list(): Connector[] {
    const saved = overlay()
    const now = Date.now()
    return CONNECTOR_CATALOG.map((c) => ({
      ...c,
      status: saved[c.id]?.status ?? 'disconnected',
      note: saved[c.id]?.note,
      updatedAt: saved[c.id]?.updatedAt ?? now,
    }))
  }

  return {
    list,
    upsert(id, status, note) {
      const catalog = CONNECTOR_CATALOG.find((c) => c.id === id)
      if (!catalog) throw new Error(`unknown connector: ${id}`)
      const saved = overlay()
      saved[id] = { status, note: note?.trim() || saved[id]?.note, updatedAt: Date.now() }
      db.write(saved)
      return list().find((c) => c.id === id)!
    },
    flush: () => db.flush(),
  }
}

export function connectorPromptBlock(rows: Connector[]): string {
  const live = rows.filter((c) => c.status === 'connected')
  if (!live.length) {
    return 'Connectors: none connected. Stay in the local workspace unless the user points elsewhere.'
  }
  return [
    'Connected tools (use these when the job needs them; never send or spend without asking):',
    ...live.map((c) => `- ${c.name}: ${c.description}${c.note ? ` (${c.note})` : ''}`),
  ].join('\n')
}

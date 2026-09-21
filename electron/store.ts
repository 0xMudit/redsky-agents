import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { JsonStore } from './lib/persist'
import { userDataDir } from './paths'
import type { Bot, ChatMessage, ComputerEvent, PendingPermission } from '../shared/types'

export type { Bot as BotRecord, ChatMessage, ComputerEvent, PendingPermission }
export type BotStatus = Bot['status']

export class TextStore<T> {
  private db: JsonStore<T>
  constructor(file: string, fallback: T) {
    this.db = new JsonStore(file, fallback)
  }
  read(): T {
    return this.db.read()
  }
  write(value: T): void {
    this.db.write(value)
  }
}

export interface BotStore {
  list: () => Bot[]
  get: (id: string) => Bot | undefined
  upsert: (t: Bot) => Bot
  delete: (id: string) => void
  changes: EventEmitter
}

export function createBotStore(): BotStore {
  const events = new EventEmitter()
  const file = path.join(userDataDir(), 'bots.json')
  const legacy = path.join(userDataDir(), 'tasks.json')
  const db = new JsonStore<Bot[]>(file, [])
  let rows: Bot[] = db.read()
  if (!rows.length && fs.existsSync(legacy)) {
    try {
      const old = JSON.parse(fs.readFileSync(legacy, 'utf8')) as Array<Record<string, unknown>>
      rows = old.map((t, i) => migrateTask(t, i))
      db.write(rows)
    } catch {
      /* ignore broken legacy */
    }
  }
  const persist = () => db.write(rows)
  return {
    list: () => [...rows].sort((a, b) => b.updatedAt - a.updatedAt),
    get: (id) => rows.find((r) => r.id === id),
    upsert(t) {
      const i = rows.findIndex((r) => r.id === t.id)
      if (i >= 0) rows[i] = t
      else rows.push(t)
      persist()
      events.emit('updated', t)
      return t
    },
    delete(id) {
      rows = rows.filter((r) => r.id !== id)
      persist()
      events.emit('deleted', id)
    },
    changes: events,
  }
}

function migrateTask(t: Record<string, unknown>, i: number): Bot {
  const thread = Array.isArray(t.thread)
    ? (t.thread as ChatMessage[])
    : ([
        t.prompt ? { role: 'user' as const, text: String(t.prompt) } : null,
        t.transcript ? { role: 'assistant' as const, text: String(t.transcript) } : null,
      ].filter(Boolean) as ChatMessage[])
  const status = t.status === 'running' ? 'idle' : t.status === 'waiting' ? 'waiting' : t.status === 'error' ? 'error' : 'idle'
  return {
    id: String(t.id ?? `bot_${i}`),
    name: String(t.title || t.name || 'New agent'),
    job: '',
    hue: HUES[i % HUES.length],
    sessionId: String(t.sessionId ?? ''),
    model: typeof t.model === 'string' ? t.model : undefined,
    status,
    error: typeof t.error === 'string' ? t.error : undefined,
    preview: thread.at(-1)?.text?.slice(0, 120) ?? '',
    thread,
    computer: [],
    createdAt: Number(t.createdAt ?? Date.now()),
    updatedAt: Number(t.updatedAt ?? Date.now()),
  }
}

export const HUES = ['#54B9A6', '#F19D38', '#6464EF', '#885CF5', '#3C82F6', '#ED712E', '#EC4899', '#10B981']

export { createBotStore as createTaskStore }
export type { Bot as TaskRecord }

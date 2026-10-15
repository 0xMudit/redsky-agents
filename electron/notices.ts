import * as path from 'node:path'
import { JsonStore } from './lib/persist'
import { newId } from './lib/ids'
import { userDataDir } from './paths'
import type { AppNotice, NoticeKind } from '../shared/types'

const MAX = 80

export interface NoticeStore {
  list: () => AppNotice[]
  add: (input: { kind: NoticeKind; botId: string; title: string; body: string }) => AppNotice
  markRead: (id: string) => AppNotice[]
  markAllRead: () => AppNotice[]
  clear: () => void
  /** Flush any pending debounced write immediately. Call on app.before-quit. */
  flush: () => void
}

export function createNoticeStore(): NoticeStore {
  const db = new JsonStore<AppNotice[]>(path.join(userDataDir(), 'notices.json'), [])
  let rows = db.read()
  const persist = () => db.write(rows)

  return {
    list: () => [...rows].sort((a, b) => b.at - a.at),
    add(input) {
      const notice: AppNotice = {
        id: newId('n'),
        kind: input.kind,
        botId: input.botId,
        title: input.title,
        body: input.body.slice(0, 280),
        at: Date.now(),
        read: false,
      }
      rows = [notice, ...rows].slice(0, MAX)
      persist()
      return notice
    },
    markRead(id) {
      const row = rows.find((n) => n.id === id)
      if (row) row.read = true
      persist()
      return this.list()
    },
    markAllRead() {
      for (const n of rows) n.read = true
      persist()
      return this.list()
    },
    clear() {
      rows = []
      persist()
    },
    flush: () => db.flush(),
  }
}

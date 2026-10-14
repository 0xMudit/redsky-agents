import * as path from 'node:path'
import { newId } from './lib/ids'
import { openDatabase, migrate, isSqliteAvailable, type SqliteDatabase } from './lib/sqlite'
import { userDataDir } from './paths'
import { safeTime, tokenize } from './vault'
import type { MemoryRow, Note, NoteHit } from '../shared/types'

/**
 * Red Sky's local database (`chat.db`): one SQLite file in `userData` holding the
 * searchable conversation record, user settings, the durable profile, and the
 * append-only behaviour stream. It is created and migrated on first run, so a
 * new install needs no setup.
 *
 * This layer is additive: the JSON stores keep working, and if `node:sqlite` is
 * unavailable every method returns an empty/neutral value instead of throwing, so
 * the app degrades to its pre-database behaviour.
 */

export interface TurnInput {
  id?: string
  at?: number
  role: 'user' | 'assistant' | 'system'
  text: string
  botId?: string
  botName?: string
  user?: string
}

export interface MessageHit {
  id: string
  at: number
  role: string
  text: string
  botId: string
  botName: string
  user?: string
  snippet: string
  score: number
}

export interface EventInput {
  type: string
  name: string
  user?: string
  botId?: string
  sessionId?: string
  props?: unknown
}

export interface EventRow {
  id: string
  at: number
  type: string
  name: string
  user?: string
  botId?: string
  sessionId?: string
  props?: unknown
}

export interface SearchOptions {
  limit?: number
  botId?: string
  user?: string
}

export interface NoteInput {
  id?: string
  title?: string
  body?: string
  tags?: string[]
  pinned?: boolean
  source?: string
  botId?: string
  at?: number
}

export interface NotePatch {
  title?: string
  body?: string
  tags?: string[]
  pinned?: boolean
}

export interface Database {
  readonly file: string
  readonly available: boolean
  init: () => void
  close: () => void
  messages: {
    index: (turn: TurnInput) => boolean
    backfill: (turns: TurnInput[]) => number
    search: (query: string, opts?: SearchOptions) => MessageHit[]
    count: () => number
  }
  settings: {
    set: (key: string, value: unknown) => void
    get: <T = unknown>(key: string) => T | undefined
    all: () => Record<string, unknown>
  }
  profile: {
    replace: (rows: MemoryRow[]) => void
    list: (botId?: string) => MemoryRow[]
  }
  events: {
    add: (input: EventInput) => EventRow | undefined
    list: (opts?: { limit?: number; type?: string; botId?: string }) => EventRow[]
    count: () => number
  }
  notes: {
    create: (input: NoteInput) => Note
    get: (id: string) => Note | undefined
    list: (opts?: { limit?: number }) => Note[]
    update: (id: string, patch: NotePatch) => Note | undefined
    append: (id: string, text: string) => Note | undefined
    remove: (id: string) => boolean
    search: (query: string, opts?: { limit?: number }) => NoteHit[]
    count: () => number
  }
  stats: () => { messages: number; events: number; profile: number; notes: number }
}

/** Turn a free-text query into a safe FTS5 MATCH expression: prefix-ANDed terms. */
export function toMatchQuery(query: string): string {
  // Reuse the vault's tokenizer so stopwords and single characters are dropped
  // consistently (a stopword-only query falls back to recent messages).
  const terms = [...new Set(tokenize(query))].slice(0, 12)
  if (!terms.length) return ''
  return terms.map((t) => `"${t}"*`).join(' ')
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export interface DatabaseOptions {
  /** Override the database file (tests point this at a temp dir). */
  file?: string
}

export function createDatabase(opts: DatabaseOptions = {}): Database {
  const file = opts.file ?? path.join(userDataDir(), 'chat.db')
  let db: SqliteDatabase | null = null
  let ready = false

  function init(): void {
    if (ready) return
    ready = true
    db = openDatabase(file)
    if (db) migrate(db)
  }

  function conn(): SqliteDatabase | null {
    if (!ready) init()
    return db
  }

  function readNote(id: string): Note | undefined {
    const d = conn()
    if (!d) return undefined
    const row = d.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? noteFromRow(row) : undefined
  }

  return {
    file,
    get available() {
      return isSqliteAvailable()
    },
    init,

    close() {
      if (db) {
        try {
          db.close()
        } catch {
          /* already closed */
        }
      }
      db = null
      ready = false
    },

    messages: {
      index(turn) {
        const d = conn()
        const text = turn.text?.trim()
        if (!d || !text) return false
        const result = d
          .prepare(
            'INSERT OR IGNORE INTO messages(id, at, role, text, bot_id, bot_name, user) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            turn.id ?? newId('msg'),
            safeTime(turn.at),
            turn.role,
            text,
            turn.botId ?? 'unknown',
            turn.botName ?? 'Agent',
            asText(turn.user) ?? null,
          )
        return result.changes > 0
      },

      backfill(turns) {
        const d = conn()
        if (!d) return 0
        let added = 0
        d.exec('BEGIN')
        try {
          const stmt = d.prepare(
            'INSERT OR IGNORE INTO messages(id, at, role, text, bot_id, bot_name, user) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          for (const turn of turns) {
            const text = turn.text?.trim()
            if (!text) continue
            const result = stmt.run(
              turn.id ?? newId('msg'),
              safeTime(turn.at),
              turn.role,
              text,
              turn.botId ?? 'unknown',
              turn.botName ?? 'Agent',
              asText(turn.user) ?? null,
            )
            if (result.changes > 0) added++
          }
          d.exec('COMMIT')
        } catch (err) {
          d.exec('ROLLBACK')
          throw err
        }
        return added
      },

      search(query, options = {}) {
        const d = conn()
        if (!d) return []
        const limit = Math.min(200, Math.max(1, options.limit ?? 20))
        const botId = options.botId
        const user = options.user
        const match = toMatchQuery(query)

        if (!match) {
          // No content words: most recent first, scoped by the same filters.
          return d
            .prepare(
              `SELECT id, at, role, text, bot_id, bot_name, user, text AS snippet, 0 AS score
               FROM messages
               WHERE (? IS NULL OR bot_id = ?) AND (? IS NULL OR user = ?)
               ORDER BY at DESC LIMIT ?`,
            )
            .all(botId ?? null, botId ?? null, user ?? null, user ?? null, limit)
            .map(hitFromRow)
        }

        return d
          .prepare(
            `SELECT m.id, m.at, m.role, m.text, m.bot_id, m.bot_name, m.user,
                    snippet(messages_fts, 0, '[', ']', '…', 12) AS snippet,
                    bm25(messages_fts) AS score
             FROM messages_fts
             JOIN messages m ON m.rowid = messages_fts.rowid
             WHERE messages_fts MATCH ?
               AND (? IS NULL OR m.bot_id = ?)
               AND (? IS NULL OR m.user = ?)
             ORDER BY score
             LIMIT ?`,
          )
          .all(match, botId ?? null, botId ?? null, user ?? null, user ?? null, limit)
          .map(hitFromRow)
      },

      count() {
        const d = conn()
        if (!d) return 0
        return Number((d.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n)
      },
    },

    settings: {
      set(key, value) {
        const d = conn()
        if (!d) return
        d.prepare(
          `INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        ).run(key, JSON.stringify(value), Date.now())
      },
      get<T = unknown>(key: string): T | undefined {
        const d = conn()
        if (!d) return undefined
        const row = d.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
        if (!row) return undefined
        try {
          return JSON.parse(row.value) as T
        } catch {
          return undefined
        }
      },
      all() {
        const d = conn()
        if (!d) return {}
        const out: Record<string, unknown> = {}
        for (const row of d.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>) {
          try {
            out[row.key] = JSON.parse(row.value)
          } catch {
            /* skip an unparseable value */
          }
        }
        return out
      },
    },

    profile: {
      replace(rows) {
        const d = conn()
        if (!d) return
        d.exec('BEGIN')
        try {
          d.exec('DELETE FROM user_profile')
          const stmt = d.prepare('INSERT INTO user_profile(id, key, value, bot_id, at) VALUES (?, ?, ?, ?, ?)')
          for (const row of rows) {
            stmt.run(
              row.id,
              row.key,
              row.value,
              asText(row.botId) ?? null,
              safeTime(row.updatedAt ?? row.createdAt),
            )
          }
          d.exec('COMMIT')
        } catch (err) {
          d.exec('ROLLBACK')
          throw err
        }
      },
      list(botId) {
        const d = conn()
        if (!d) return []
        const rows = botId
          ? d
              .prepare(
                'SELECT id, key, value, bot_id, at FROM user_profile WHERE bot_id IS NULL OR bot_id = ? ORDER BY at DESC',
              )
              .all(botId)
          : d.prepare('SELECT id, key, value, bot_id, at FROM user_profile ORDER BY at DESC').all()
        return (rows as Array<Record<string, unknown>>).map((r) => ({
          id: String(r.id),
          key: String(r.key),
          value: String(r.value),
          botId: asText(r.bot_id),
          createdAt: Number(r.at),
          updatedAt: Number(r.at),
        }))
      },
    },

    events: {
      add(input) {
        const d = conn()
        if (!d || !input?.type || !input?.name) return undefined
        const row: EventRow = {
          id: newId('evt'),
          at: Date.now(),
          type: input.type,
          name: input.name,
          user: asText(input.user),
          botId: asText(input.botId),
          sessionId: asText(input.sessionId),
          props: input.props,
        }
        d.prepare(
          'INSERT INTO events(id, at, user, type, name, bot_id, session_id, props) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          row.id,
          row.at,
          row.user ?? null,
          row.type,
          row.name,
          row.botId ?? null,
          row.sessionId ?? null,
          row.props === undefined ? null : JSON.stringify(row.props),
        )
        return row
      },
      list({ limit = 100, type, botId } = {}) {
        const d = conn()
        if (!d) return []
        const rows = d
          .prepare(
            `SELECT id, at, type, name, user, bot_id, session_id, props FROM events
             WHERE (? IS NULL OR type = ?) AND (? IS NULL OR bot_id = ?)
             ORDER BY at DESC LIMIT ?`,
          )
          .all(type ?? null, type ?? null, botId ?? null, botId ?? null, Math.min(1000, Math.max(1, limit)))
        return (rows as Array<Record<string, unknown>>).map((r) => ({
          id: String(r.id),
          at: Number(r.at),
          type: String(r.type),
          name: String(r.name),
          user: asText(r.user),
          botId: asText(r.bot_id),
          sessionId: asText(r.session_id),
          props: typeof r.props === 'string' ? safeParse(r.props) : undefined,
        }))
      },
      count() {
        const d = conn()
        if (!d) return 0
        return Number((d.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n)
      },
    },

    notes: {
      create(input) {
        const d = conn()
        const now = Date.now()
        const note: Note = {
          id: input.id ?? newId('note'),
          title: (input.title ?? '').trim(),
          body: input.body ?? '',
          tags: normalizeTags(input.tags),
          pinned: Boolean(input.pinned),
          source: asText(input.source),
          botId: asText(input.botId),
          createdAt: input.at ?? now,
          updatedAt: now,
        }
        if (!d) return note
        d.prepare(
          `INSERT INTO notes(id, title, body, tags, pinned, source, bot_id, at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          note.id,
          note.title,
          note.body,
          JSON.stringify(note.tags),
          note.pinned ? 1 : 0,
          note.source ?? null,
          note.botId ?? null,
          note.createdAt,
          note.updatedAt,
        )
        return note
      },
      get(id) {
        return readNote(id)
      },
      list({ limit = 200 } = {}) {
        const d = conn()
        if (!d) return []
        const rows = d
          .prepare('SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC LIMIT ?')
          .all(Math.min(1000, Math.max(1, limit)))
        return (rows as Array<Record<string, unknown>>).map(noteFromRow)
      },
      update(id, patch) {
        const d = conn()
        if (!d) return undefined
        const current = readNote(id)
        if (!current) return undefined
        const next: Note = {
          ...current,
          title: patch.title !== undefined ? patch.title.trim() : current.title,
          body: patch.body !== undefined ? patch.body : current.body,
          tags: patch.tags !== undefined ? normalizeTags(patch.tags) : current.tags,
          pinned: patch.pinned !== undefined ? Boolean(patch.pinned) : current.pinned,
          updatedAt: Date.now(),
        }
        d.prepare('UPDATE notes SET title = ?, body = ?, tags = ?, pinned = ?, updated_at = ? WHERE id = ?').run(
          next.title,
          next.body,
          JSON.stringify(next.tags),
          next.pinned ? 1 : 0,
          next.updatedAt,
          id,
        )
        return next
      },
      append(id, text) {
        const current = readNote(id)
        if (!current) return undefined
        const body = current.body.trim() ? `${current.body.replace(/\s+$/, '')}\n\n${text}` : text
        const d = conn()
        if (!d) return undefined
        const next: Note = { ...current, body, updatedAt: Date.now() }
        d.prepare('UPDATE notes SET body = ?, updated_at = ? WHERE id = ?').run(next.body, next.updatedAt, id)
        return next
      },
      remove(id) {
        const d = conn()
        if (!d) return false
        const info = d.prepare('DELETE FROM notes WHERE id = ?').run(id)
        return Number(info.changes ?? 0) > 0
      },
      search(query, { limit = 30 } = {}) {
        const d = conn()
        if (!d) return []
        const cap = Math.min(200, Math.max(1, limit))
        const match = toMatchQuery(query)
        const rows = match
          ? d
              .prepare(
                `SELECT n.id, n.title, n.tags, n.updated_at,
                        snippet(notes_fts, -1, '[', ']', ' … ', 12) AS snippet,
                        bm25(notes_fts) AS score
                 FROM notes_fts JOIN notes n ON n.rowid = notes_fts.rowid
                 WHERE notes_fts MATCH ? ORDER BY score LIMIT ?`,
              )
              .all(match, cap)
          : d
              .prepare(
                `SELECT id, title, tags, updated_at, body AS snippet, 0 AS score
                 FROM notes ORDER BY updated_at DESC LIMIT ?`,
              )
              .all(cap)
        return (rows as Array<Record<string, unknown>>).map(noteHitFromRow)
      },
      count() {
        const d = conn()
        if (!d) return 0
        return Number((d.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n)
      },
    },

    stats() {
      const d = conn()
      if (!d) return { messages: 0, events: 0, profile: 0, notes: 0 }
      return {
        messages: Number((d.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n),
        events: Number((d.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n),
        profile: Number((d.prepare('SELECT COUNT(*) AS n FROM user_profile').get() as { n: number }).n),
        notes: Number((d.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n),
      }
    },
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function hitFromRow(row: Record<string, unknown>): MessageHit {
  return {
    id: String(row.id),
    at: Number(row.at),
    role: String(row.role),
    text: String(row.text),
    botId: String(row.bot_id),
    botName: String(row.bot_name),
    user: asText(row.user),
    snippet: String(row.snippet ?? row.text),
    score: Number(row.score ?? 0),
  }
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!Array.isArray(tags)) return []
  return [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 24)
}

function parseTags(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return []
  const parsed = safeParse(value)
  return Array.isArray(parsed) ? parsed.map(String) : []
}

function noteFromRow(row: Record<string, unknown>): Note {
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    tags: parseTags(row.tags),
    pinned: Number(row.pinned) === 1,
    source: asText(row.source),
    botId: asText(row.bot_id),
    createdAt: Number(row.at),
    updatedAt: Number(row.updated_at),
  }
}

function noteHitFromRow(row: Record<string, unknown>): NoteHit {
  return {
    id: String(row.id),
    title: String(row.title ?? 'Untitled note'),
    snippet: String(row.snippet ?? ''),
    tags: parseTags(row.tags),
    updatedAt: Number(row.updated_at),
    score: Number(row.score ?? 0),
  }
}

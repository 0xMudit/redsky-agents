import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Low-level SQLite access for Red Sky's local database.
 *
 * The database is `chat.db` in `userData`, created and migrated on first run —
 * a new install needs no setup step. It is backed by Node's built-in
 * `node:sqlite` (Node 22.13+, which is what Electron 37 ships), so there is no
 * native module to compile, no `electron-rebuild`, and no packaging changes.
 *
 * Every function here degrades gracefully: if `node:sqlite` is unavailable the
 * app keeps running on the JSON stores and callers see `null`.
 */

type SqliteModule = typeof import('node:sqlite')
export type SqliteDatabase = import('node:sqlite').DatabaseSync
export type SqliteStatement = import('node:sqlite').StatementSync

let cached: SqliteModule | null | undefined
let silenced = false

/**
 * Node prints an ExperimentalWarning the first time `node:sqlite` is required.
 * It is noise in a desktop app's logs, so drop that one warning and nothing else.
 */
function silenceExperimentalWarning(): void {
  if (silenced) return
  silenced = true
  const original = process.emitWarning.bind(process)
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const message = typeof warning === 'string' ? warning : warning?.message ?? ''
    if (/SQLite is an experimental feature/i.test(message)) return
    return (original as (...args: unknown[]) => void)(warning, ...rest)
  }) as typeof process.emitWarning
}

/** The `node:sqlite` module, or `null` when the runtime does not provide it. */
export function sqliteModule(): SqliteModule | null {
  if (cached !== undefined) return cached
  try {
    silenceExperimentalWarning()
    // Lazy require so a runtime without node:sqlite never breaks import of the app.
    cached = require('node:sqlite') as SqliteModule
  } catch {
    cached = null
  }
  return cached
}

export function isSqliteAvailable(): boolean {
  return sqliteModule() !== null
}

/** Open (creating if needed) a SQLite database in WAL mode. Returns null if unavailable. */
export function openDatabase(file: string): SqliteDatabase | null {
  const mod = sqliteModule()
  if (!mod) return null
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const db = new mod.DatabaseSync(file, { timeout: 5000, enableForeignKeyConstraints: true })
    // WAL keeps readers fast while writes are in flight; NORMAL is durable enough
    // for an append-mostly local store and much cheaper than FULL.
    db.exec('PRAGMA journal_mode = WAL;')
    db.exec('PRAGMA synchronous = NORMAL;')
    return db
  } catch {
    return null
  }
}

interface Migration {
  version: number
  name: string
  sql: string
}

/**
 * Ordered, append-only schema history. Each migration is applied once and
 * recorded in `schema_migrations`; adding a feature means adding a new entry,
 * never editing an old one.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
      -- Durable, searchable record of every user/agent exchange.
      CREATE TABLE IF NOT EXISTS messages (
        id        TEXT PRIMARY KEY,
        at        INTEGER NOT NULL,
        role      TEXT NOT NULL,
        text      TEXT NOT NULL,
        bot_id    TEXT NOT NULL,
        bot_name  TEXT NOT NULL,
        user      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_bot ON messages(bot_id, at);
      CREATE INDEX IF NOT EXISTS idx_messages_at  ON messages(at);

      -- Full-text index over message text, kept in sync by triggers. External
      -- content means the text lives once in messages, not duplicated here.
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        text, bot_name,
        content='messages', content_rowid='rowid',
        tokenize='porter unicode61'
      );
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, text, bot_name) VALUES (new.rowid, new.text, new.bot_name);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, text, bot_name) VALUES ('delete', old.rowid, old.text, old.bot_name);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, text, bot_name) VALUES ('delete', old.rowid, old.text, old.bot_name);
        INSERT INTO messages_fts(rowid, text, bot_name) VALUES (new.rowid, new.text, new.bot_name);
      END;

      -- User settings as a key/value overlay.
      CREATE TABLE IF NOT EXISTS settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Durable facts about the user (mirror of the memory store).
      CREATE TABLE IF NOT EXISTS user_profile (
        id     TEXT PRIMARY KEY,
        key    TEXT NOT NULL,
        value  TEXT NOT NULL,
        bot_id TEXT,
        at     INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_profile_bot ON user_profile(bot_id);

      -- Append-only behaviour stream. Rows are never updated or deleted; this is
      -- the raw material for ranking and for offline ML feature engineering.
      CREATE TABLE IF NOT EXISTS events (
        id         TEXT PRIMARY KEY,
        at         INTEGER NOT NULL,
        user       TEXT,
        type       TEXT NOT NULL,
        name       TEXT NOT NULL,
        bot_id     TEXT,
        session_id TEXT,
        props      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_at   ON events(at);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, at);

      -- Reserved for semantic recall (vectors stored as BLOBs, scored in process).
      CREATE TABLE IF NOT EXISTS embeddings (
        msg_id TEXT PRIMARY KEY,
        dim    INTEGER NOT NULL,
        vec    BLOB NOT NULL,
        model  TEXT,
        at     INTEGER NOT NULL
      );
    `,
  },
]

/** Apply any migrations this database has not seen yet. Idempotent. */
export function migrate(db: SqliteDatabase): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);')
  const current = (db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number }).v
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    db.exec('BEGIN')
    try {
      db.exec(migration.sql)
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(migration.version, Date.now())
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(`red-sky: migration ${migration.version} (${migration.name}) failed: ${(err as Error).message}`)
    }
  }
}

/** For tests: forget the cached module so a fresh process state can be re-read. */
export function resetSqliteCacheForTests(): void {
  cached = undefined
}

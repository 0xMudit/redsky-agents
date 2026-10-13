import { app } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { newId } from './lib/ids'
import type { MemoryRow } from '../shared/types'

/**
 * The knowledge vault.
 *
 * Every message Red Sky and a teammate exchange is written here in the
 * background — a durable, human-readable record of the user's conversations
 * that survives reinstalls, provider changes, and cleared threads. It is
 * modelled on two ideas:
 *
 *  - the "LLM wiki" pattern: raw sources stay immutable, a markdown layer is
 *    derived from them, and `index.md` / `log.md` make the whole thing
 *    navigable without embedding infrastructure;
 *  - the Hermes agent loop: agent-curated memory, a growing model of the user,
 *    and keyword search over past sessions folded back into the prompt.
 *
 * The vault lives in the user's Documents folder so it travels with their files
 * on every platform and stays separate per OS account. Files are only ever
 * appended to or rewritten whole; nothing else in Documents is touched.
 */

export type VaultRole = 'user' | 'assistant' | 'system'

/** One recorded message. `id` matches the chat message id so writes are idempotent. */
export interface VaultTurn {
  id: string
  at: number
  role: VaultRole
  text: string
  botId: string
  botName: string
  /** Who was talking. Untagged turns read as the local default. */
  user?: string
}

export interface VaultTurnInput {
  id?: string
  at?: number
  role: VaultRole
  text: string
  botId?: string
  botName?: string
  user?: string
}

export interface RecallOptions {
  /** Prefer turns from this teammate (others are still eligible). */
  botId?: string
  k?: number
  /** Turn ids to leave out — used to keep the prompt from echoing its own question. */
  excludeIds?: string[]
  /** Only consider turns this person was part of. */
  user?: string
}

export interface Vault {
  readonly root: string
  /** Create the directory tree and seed the schema / index / log / profile. Idempotent. */
  init: () => void
  /** Append a turn (no-op for blank text or an id already recorded). Returns the stored turn. */
  recordTurn: (input: VaultTurnInput) => VaultTurn | undefined
  /** Append a human-readable event (agent created, thread cleared, …) to `log.md`. */
  note: (event: string, detail: string, bot?: { id: string; name: string }) => void
  hasTurn: (id: string) => boolean
  turns: (botId?: string) => VaultTurn[]
  /** Rank past turns against a query using the in-process index. */
  recall: (query: string, opts?: RecallOptions) => VaultTurn[]
  /** Render the user model + recalled excerpts to append to a system prompt. */
  contextBlock: (botId: string, query?: string, excludeIds?: string[], user?: string) => string
  /** Re-render `profile.md` from the durable-fact store. */
  syncProfile: (facts: MemoryRow[]) => void
  /** The AGENTS.md schema describing how the vault is laid out. */
  schema: () => string
}

export const VAULT_DIRNAME = 'Red Sky'

/** Root of the vault. Documents is per OS account, so files never mix between users. */
export function vaultRoot(): string {
  let base: string
  try {
    base = app.getPath('documents')
  } catch {
    // Some Linux setups have no XDG documents dir; fall back to app data.
    try {
      base = app.getPath('userData')
    } catch {
      base = process.cwd()
    }
  }
  return path.join(base, VAULT_DIRNAME)
}

interface VaultPaths {
  root: string
  schema: string
  index: string
  log: string
  profile: string
  conversations: string
  raw: string
}

function vaultPaths(root: string): VaultPaths {
  return {
    root,
    schema: path.join(root, 'AGENTS.md'),
    index: path.join(root, 'index.md'),
    log: path.join(root, 'log.md'),
    profile: path.join(root, 'profile.md'),
    conversations: path.join(root, 'conversations'),
    raw: path.join(root, 'raw'),
  }
}

/** Keep one teammate's files to a safe, stable name (no separators, no `..` runs, no dotfiles). */
function safeFile(id: string, fallback = 'unknown'): string {
  const clean = (id || '')
    .replace(/\.{2,}/g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^[._-]+/, '')
    .slice(0, 96)
  return clean || fallback
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'for', 'of', 'to', 'in', 'on', 'at', 'by', 'with',
  'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'you', 'we', 'they', 'he', 'she', 'my', 'your', 'our', 'their', 'me', 'us', 'them', 'do', 'does', 'did',
  'done', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must', 'not', 'no',
  'yes', 'so', 'too', 'very', 'just', 'about', 'into', 'over', 'after', 'before', 'up', 'down', 'out', 'off',
  'again', 'here', 'there', 'when', 'where', 'why', 'how', 'what', 'which', 'who', 'whom', 'all', 'any', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'also', 'get', 'got', 'make',
  'made', 'use', 'used', 'using', 'let', 'lets', 'please', 'want', 'need', 'like',
])

export function tokenize(text: string): string[] {
  const found = text.toLowerCase().match(/[a-z0-9_]{2,}/g)
  if (!found) return []
  return found.filter((t) => !STOPWORDS.has(t))
}

/**
 * Coerce a timestamp (ms number, numeric string, or ISO date string) to a finite
 * ms value. Anything else — including NaN and `null` left behind by older
 * versions — falls back to now, so corpus writes and derived files never crash
 * on an Invalid Date.
 */
export function safeTime(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const asNum = Number(value)
    if (Number.isFinite(asNum)) return asNum
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return Date.now()
}

/** Pure-JS inverted index. Personal-scale corpora, so no SQLite/FTS dependency. */
export class VaultCorpus {
  private postings = new Map<string, Map<string, number>>()
  private byId = new Map<string, VaultTurn>()
  private order: string[] = []

  add(turn: VaultTurn): void {
    if (this.byId.has(turn.id)) return
    this.byId.set(turn.id, turn)
    this.order.push(turn.id)

    const tf = new Map<string, number>()
    for (const token of tokenize(`${turn.botName} ${turn.text}`)) tf.set(token, (tf.get(token) ?? 0) + 1)
    for (const [token, count] of tf) {
      let post = this.postings.get(token)
      if (!post) {
        post = new Map()
        this.postings.set(token, post)
      }
      post.set(turn.id, count)
    }
  }

  has(id: string): boolean {
    return this.byId.has(id)
  }

  get size(): number {
    return this.byId.size
  }

  all(): VaultTurn[] {
    return this.order.map((id) => this.byId.get(id) as VaultTurn)
  }

  search(query: string, k: number, botId?: string, excludeIds?: string[], user?: string): VaultTurn[] {
    const exclude = new Set(excludeIds ?? [])
    const terms = [...new Set(tokenize(query))]
    if (!terms.length) {
      return this.all()
        .filter((t) => !exclude.has(t.id) && (!botId || t.botId === botId) && (!user || t.user === user))
        .slice(-k)
        .reverse()
    }

    const n = this.byId.size || 1
    const scores = new Map<string, number>()
    for (const term of terms) {
      const post = this.postings.get(term)
      if (!post) continue
      const idf = Math.log(1 + n / post.size)
      for (const [id, tf] of post) {
        if (exclude.has(id)) continue
        const turn = this.byId.get(id) as VaultTurn
        if (user && turn.user !== user) continue
        const boost = botId && turn.botId === botId ? 1.4 : 1
        scores.set(id, (scores.get(id) ?? 0) + (1 + Math.log(tf)) * idf * boost)
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1] || (this.byId.get(b[0]) as VaultTurn).at - (this.byId.get(a[0]) as VaultTurn).at)
      .slice(0, k)
      .map(([id]) => this.byId.get(id) as VaultTurn)
  }
}

export interface VaultOptions {
  /** Override the vault root (tests point this at a temp dir). */
  root?: string
}

export function createVault(opts: VaultOptions = {}): Vault {
  const root = opts.root ?? vaultRoot()
  const p = vaultPaths(root)
  const corpus = new VaultCorpus()
  let facts: MemoryRow[] = []
  let ready = false

  const SCHEMA = `# Red Sky knowledge vault

Red Sky writes here automatically, in the background, every time you and an agent
exchange messages. The agent does not edit these files directly — they are the
record of the user's conversations, and relevant parts are folded back into the
prompt at the start of each run.

## Layout

- \`profile.md\` — what is known about the user: preferences and ongoing work
- \`index.md\` — a catalog of every conversation, one entry per agent
- \`log.md\` — append-only and chronological: \`## [ISO] event | agent\`
- \`conversations/<agent>.md\` — the readable transcript of one agent's thread
- \`raw/<agent>.jsonl\` — the immutable record every transcript is rendered from

## Keeping continuity

- Treat the "Things you remember about this user" and "Excerpts recalled from
  earlier conversations" blocks as memory of past sessions.
- If the user refers to something from before, use those excerpts instead of
  asking them to repeat it.
- To save a durable fact, end a reply with a line starting
  \`Noted for next time: <fact>\`. Red Sky files it into \`profile.md\`.
- Add to what is known instead of restating it, and never copy secrets or
  personal data into an outbound draft.
`

  function writeIfChanged(file: string, content: string): void {
    try {
      const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
      if (prev === content) return
      fs.writeFileSync(file, content, 'utf8')
    } catch {
      /* the vault must never crash a conversation */
    }
  }

  function ensureFile(file: string, content: string): void {
    if (fs.existsSync(file)) return
    try {
      fs.writeFileSync(file, content, 'utf8')
    } catch {
      /* ignore */
    }
  }

  /** Rebuild the in-memory index from the immutable raw transcripts. */
  function loadRaw(): void {
    let files: string[] = []
    try {
      files = fs.readdirSync(p.raw).filter((name) => name.endsWith('.jsonl'))
    } catch {
      return
    }
    for (const name of files) {
      let raw: string
      try {
        raw = fs.readFileSync(path.join(p.raw, name), 'utf8')
      } catch {
        continue
      }
      for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const rec = JSON.parse(trimmed) as Partial<VaultTurn>
          if (!rec || typeof rec.text !== 'string' || !rec.text.trim()) continue
          corpus.add({
            id: String(rec.id ?? newId('turn')),
            at: safeTime(rec.at),
            role: rec.role === 'user' || rec.role === 'system' ? rec.role : 'assistant',
            text: rec.text,
            botId: String(rec.botId ?? 'unknown'),
            botName: String(rec.botName ?? 'Agent'),
            user: typeof rec.user === 'string' && rec.user.trim() ? rec.user : undefined,
          })
        } catch {
          /* skip a torn line */
        }
      }
    }
  }

  function init(): void {
    if (ready) return
    ready = true
    try {
      fs.mkdirSync(p.conversations, { recursive: true })
      fs.mkdirSync(p.raw, { recursive: true })
    } catch {
      /* ignore */
    }
    ensureFile(p.schema, SCHEMA)
    ensureFile(p.log, `# Conversation log\n\n_Append-only. Newest entries at the bottom._\n`)
    ensureFile(p.index, `# Conversation index\n\n_Every conversation Red Sky has recorded, grouped by agent._\n`)
    ensureFile(p.profile, `# User profile\n\n_Nothing noted yet. Red Sky fills this in as it learns._\n`)
    loadRaw()
  }

  function appendRaw(turn: VaultTurn): void {
    try {
      fs.appendFileSync(path.join(p.raw, `${safeFile(turn.botId)}.jsonl`), `${JSON.stringify(turn)}\n`, 'utf8')
    } catch {
      /* ignore */
    }
  }

  function appendConversation(turn: VaultTurn): void {
    const file = path.join(p.conversations, `${safeFile(turn.botId)}.md`)
    try {
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, `# Conversation with ${turn.botName}\n\n_Agent \`${turn.botId}\` · recorded automatically._\n`, 'utf8')
      }
      const when = new Date(safeTime(turn.at)).toISOString()
      fs.appendFileSync(file, `\n## [${when}] ${turn.role}\n\n${turn.text}\n`, 'utf8')
    } catch {
      /* ignore */
    }
  }

  function appendLog(event: string, detail: string, bot?: { id: string; name: string }): void {
    const when = new Date().toISOString()
    const oneLine = detail.replace(/\s+/g, ' ').trim().slice(0, 160)
    const who = bot ? ` | ${bot.name}` : ''
    try {
      fs.appendFileSync(p.log, `\n## [${when}] ${event}${who}\n${oneLine}\n`, 'utf8')
    } catch {
      /* ignore */
    }
  }

  function rebuildIndex(): void {
    const groups = new Map<string, VaultTurn[]>()
    for (const turn of corpus.all()) {
      const list = groups.get(turn.botId) ?? []
      list.push(turn)
      groups.set(turn.botId, list)
    }
    const lines = ['# Conversation index', '', '_Every conversation Red Sky has recorded, grouped by agent._', '']
    const ordered = [...groups.entries()].sort((a, b) => (b[1].at(-1)?.at ?? 0) - (a[1].at(-1)?.at ?? 0))
    for (const [botId, list] of ordered) {
      const name = list.at(-1)?.botName ?? 'Agent'
      const last = new Date(safeTime(list.at(-1)?.at)).toISOString().slice(0, 10)
      const firstAsk = list.find((t) => t.role === 'user')?.text ?? list[0]?.text ?? ''
      lines.push(`## ${name} — \`${botId}\``)
      lines.push(`- ${list.length} turns · last active ${last}`)
      lines.push(`- file: \`conversations/${safeFile(botId)}.md\``)
      if (firstAsk) lines.push(`- opened with: ${firstAsk.replace(/\s+/g, ' ').trim().slice(0, 120)}`)
      lines.push('')
    }
    writeIfChanged(p.index, `${lines.join('\n').trimEnd()}\n`)
  }

  function snippet(text: string, query: string): string {
    const terms = tokenize(query)
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
    const hit = lines.find((line) => terms.some((t) => line.toLowerCase().includes(t)))
    const chosen = hit ?? lines[0] ?? text
    return chosen.replace(/\s+/g, ' ').slice(0, 220)
  }

  function recordTurn(input: VaultTurnInput): VaultTurn | undefined {
    const text = input.text?.trim()
    if (!text) return undefined
    init()
    const id = input.id ?? newId('turn')
    if (corpus.has(id)) return undefined
    const turn: VaultTurn = {
      id,
      at: safeTime(input.at),
      role: input.role,
      text,
      botId: input.botId || 'unknown',
      botName: input.botName || 'Agent',
      user: input.user && input.user.trim() ? input.user.trim() : undefined,
    }
    corpus.add(turn)
    appendRaw(turn)
    appendConversation(turn)
    appendLog('turn', `${turn.role}: ${text}`, { id: turn.botId, name: turn.botName })
    rebuildIndex()
    return turn
  }

  function syncProfile(rows: MemoryRow[]): void {
    facts = rows
    init()
    const global = rows.filter((r) => !r.botId)
    const scoped = rows.filter((r) => r.botId)
    const lines = [
      '# User profile',
      '',
      `_Maintained automatically by Red Sky. Last updated ${new Date().toISOString()}._`,
      '',
      '## About you',
      '',
      ...(global.length ? global.map((r) => `- **${r.key}**: ${r.value}`) : ['- _(nothing noted yet)_']),
      '',
    ]
    if (scoped.length) {
      lines.push('## Notes from teammates', '', ...scoped.map((r) => `- **${r.key}**: ${r.value}`), '')
    }
    writeIfChanged(p.profile, `${lines.join('\n').trimEnd()}\n`)
  }

  function contextBlock(botId: string, query = '', excludeIds: string[] = [], user?: string): string {
    init()
    const blocks: string[] = []
    if (facts.length) {
      const remembered = facts.slice(0, 8).map((f) => `- ${f.key}: ${f.value}`).join('\n')
      blocks.push(`Things you remember about this user${user ? ` (${user})` : ''}:\n${remembered}`)
    }
    const recalled = corpus.search(query, 6, botId, excludeIds, user)
    if (recalled.length) {
      const lines = recalled.map(
        (t) => `- [${new Date(safeTime(t.at)).toISOString().slice(0, 10)} · ${t.botName}] ${snippet(t.text, query)}`,
      )
      blocks.push(
        'Excerpts recalled from earlier conversations — this is memory from past sessions. Use it for continuity; do not quote it verbatim unless asked:\n' +
          lines.join('\n'),
      )
    }
    return blocks.length ? `\n\n${blocks.join('\n\n')}` : ''
  }

  return {
    root,
    init,
    recordTurn,
    note: (event, detail, bot) => {
      init()
      appendLog(event, detail, bot)
    },
    hasTurn: (id) => {
      init()
      return corpus.has(id)
    },
    turns: (botId) => {
      init()
      const all = corpus.all()
      return botId ? all.filter((t) => t.botId === botId) : all
    },
    recall: (query, options) => {
      init()
      return corpus.search(query, options?.k ?? 6, options?.botId, options?.excludeIds, options?.user)
    },
    contextBlock,
    syncProfile,
    schema: () => SCHEMA,
  }
}

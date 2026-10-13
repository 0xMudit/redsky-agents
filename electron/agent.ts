import { EventEmitter } from 'node:events'
import { audit } from './audit'
import { buildHandoffPrompt, parseMentions } from './collab'
import { connectorPromptBlock, type ConnectorStore } from './connectors'
import { api, apiEmpty, type ModelRef } from './http'
import { newId } from './lib/ids'
import { createMemoryStore, type MemoryStore } from './memory'
import { workspaceDir } from './paths'
import { needsHumanReview, reviewReason } from './policy'
import { type RoomStore } from './rooms'
import { serverEvents } from './server'
import { type SettingsStore } from './settings'
import { parseCancelReminder, parseReminder, reminderLabel } from './remind'
import { createBotStore, HUES, type BotRecord, type BotStore, type ChatMessage, type ComputerEvent } from './store'
import { createTipEngine } from './tips'
import { safeTime, type Vault } from './vault'
import { diffSnaps, searchWorkspaceFiles, snapshotWorkspace, type FileSnap } from './workspace'
import { partLooksLikeThinking, previewOf, stripThinking } from '../shared/visible'
import type { Artifact, Routine, SearchHit } from '../shared/types'

export interface AgentDeps {
  connectors: ConnectorStore
  rooms: RoomStore
  settings: SettingsStore
  scheduleReminder: (botId: string, schedule: string, prompt: string) => Routine
  cancelReminders: (botId: string) => number
  /** Durable conversation record. Optional so pure-in-memory tests can omit it. */
  vault?: Vault
}

export interface AgentHandle {
  events: EventEmitter
  attach: (baseUrl: string) => void
  createBot: (input?: { name?: string; job?: string }) => Promise<BotRecord>
  renameBot: (botId: string, name: string, job?: string) => Promise<BotRecord>
  duplicateBot: (botId: string) => Promise<BotRecord>
  setBotFlags: (botId: string, flags: { pinned?: boolean; archived?: boolean }) => BotRecord
  reorderBots: (orderedIds: string[]) => BotRecord[]
  branchFrom: (botId: string, prompt: string, model?: ModelRef) => Promise<BotRecord>
  send: (botId: string, input: { text: string; model?: ModelRef; roomId?: string; internal?: boolean; attachments?: string[] }) => Promise<BotRecord>
  abort: (botId: string) => Promise<void>
  deleteBot: (botId: string) => Promise<void>
  patchMessage: (botId: string, messageId: string, text: string) => BotRecord
  deleteMessage: (botId: string, messageId: string) => BotRecord
  clearThread: (botId: string) => BotRecord
  resendFrom: (botId: string, messageId: string, model?: ModelRef) => Promise<BotRecord>
  listBots: () => BotRecord[]
  getBot: (botId: string) => BotRecord | undefined
  respondPermission: (botId: string, permissionId: string, response: 'once' | 'always' | 'reject') => Promise<void>
  setWatchMode: (botId: string, enabled: boolean) => BotRecord
  attachRoom: (botId: string, roomId: string) => void
  lastUserPrompt: (botId: string) => string | undefined
  /** A model-written life tip for the small "working" window. */
  lifeTip: () => Promise<string>
  /** Pre-generate tips in the background so the first send has them ready. */
  warmTips: () => void
  search: (query: string) => SearchHit[]
  nudgeReminder: (botId: string, prompt: string) => BotRecord | undefined
  /** Fold existing threads into the vault so they count as history. */
  importHistory: () => number
  listFiles: (rel?: string) => Promise<Array<{ name: string; path: string; type?: string }>>
  readFile: (rel: string) => Promise<string>
  store: BotStore
  memory: MemoryStore
  vault?: Vault
}

export const JOB_TEMPLATES: Array<{ name: string; job: string }> = [
  {
    name: 'Sales Outbound',
    job: 'Generate pipeline overnight. Research accounts, score contacts, and draft outreach in the user\'s voice for approval.',
  },
  {
    name: 'Talent Scout',
    job: 'Research people and roles, draft intros in the user\'s voice, and hold them for review.',
  },
  {
    name: 'Paid Media',
    job: 'Watch campaigns, draft optimizations, and leave a review list instead of changing live spend.',
  },
  {
    name: 'Expense Manager',
    job: 'Organize receipts and draft expense notes in the workspace.',
  },
  {
    name: 'Product Performance',
    job: 'Track product metrics, flag regressions, and write a short weekly readout.',
  },
  {
    name: 'Bug Reproduction',
    job: 'Reproduce software issues in the workspace, capture logs, and write a clear report.',
  },
  {
    name: 'Account Health',
    job: 'Track accounts, follow threads, and draft outreach without sending until asked.',
  },
  {
    name: 'Chief of Staff',
    job: 'Coordinate work across other bots, keep priorities straight, and come back with decisions that need a human.',
  },
]

function sessionIdOf(evt: { type: string; properties?: Record<string, unknown>; data?: unknown }): string {
  const props = (evt.properties ?? {}) as Record<string, unknown>
  const data = (evt.data ?? {}) as Record<string, unknown>
  const part = props.part as Record<string, unknown> | undefined
  return String(
    props.sessionID ??
      props.sessionId ??
      data.sessionID ??
      data.sessionId ??
      part?.sessionID ??
      '',
  )
}

function modelRefFrom(encoded?: string): ModelRef | undefined {
  if (!encoded) return undefined
  const sep = encoded.indexOf('\u241f')
  if (sep <= 0) return undefined
  const providerID = encoded.slice(0, sep)
  const modelID = encoded.slice(sep + 1)
  return providerID && modelID ? { providerID, modelID } : undefined
}

export function createAgent(deps: AgentDeps): AgentHandle {
  const events = new EventEmitter()
  const store = createBotStore()
  const memory = createMemoryStore()
  const botBySession = new Map<string, string>()
  const partText = new Map<string, Map<string, string>>()
  const flushTimer = new Map<string, ReturnType<typeof setTimeout>>()
  const hydrateTimer = new Map<string, ReturnType<typeof setTimeout>>()
  const queued = new Map<string, { text: string; model?: ModelRef; roomId?: string }>()
  const snaps = new Map<string, FileSnap[]>()
  // The turn id of the user message currently being answered, so the prompt's
  // recalled-memory block doesn't just hand the model back its own question.
  const pendingTurn = new Map<string, string>()
  const vault = deps.vault
  // Model-written life tips, generated through the same OpenCode server but in
  // their own throwaway session so they never touch an agent's thread.
  const tips = createTipEngine({ baseUrl: () => baseUrl })

  let baseUrl = ''
  let attached = false

  for (const b of store.list()) {
    if (b.sessionId) botBySession.set(b.sessionId, b.id)
    if (b.status === 'running') {
      b.status = 'idle'
      store.upsert(b)
    }
  }

  function emitBot(bot: BotRecord): void {
    events.emit('event', { source: 'bot', bot: snapshot(bot) })
  }

  function snapshot(bot: BotRecord): BotRecord {
    for (const m of bot.thread) {
      if (!m.id) m.id = newId('m')
      if (m.role === 'assistant') m.text = stripThinking(m.text)
    }
    return {
      ...bot,
      thread: bot.thread.map((m) => ({ ...m })),
      computer: bot.computer.slice(-40),
      roomIds: bot.roomIds ? [...bot.roomIds] : undefined,
    }
  }

  function queueFlush(bot: BotRecord): void {
    const prev = flushTimer.get(bot.id)
    if (prev) clearTimeout(prev)
    flushTimer.set(
      bot.id,
      setTimeout(() => {
        flushTimer.delete(bot.id)
        bot.updatedAt = Date.now()
        store.upsert(bot)
        emitBot(bot)
      }, 80),
    )
  }

  function pushComputer(bot: BotRecord, ev: Omit<ComputerEvent, 'id'> & { id?: string }): void {
    const last = bot.computer[bot.computer.length - 1]
    if (last && last.kind === ev.kind && last.title === ev.title && last.detail === ev.detail) return
    bot.computer.push({
      id: ev.id ?? newId('c'),
      kind: ev.kind,
      title: ev.title,
      detail: ev.detail.slice(0, 2000),
      at: ev.at,
    })
    if (bot.computer.length > 80) bot.computer = bot.computer.slice(-80)
  }

  function collectArtifacts(bot: BotRecord): Artifact[] {
    const seen = new Set<string>()
    const out: Artifact[] = []
    const add = (p: string) => {
      const path = p.replace(/\\/g, '/').trim()
      if (!path || seen.has(path) || path.length > 240) return
      seen.add(path)
      out.push({ path, title: path.split('/').pop() || path })
    }
    for (const c of bot.computer) {
      if (c.kind !== 'file' && c.kind !== 'tool') continue
      const m = `${c.title} ${c.detail}`.match(/(?:[\w./\\-]+\.\w{1,8})/g)
      if (m) for (const hit of m.slice(0, 4)) add(hit)
    }
    for (const p of bot.runDiff?.added ?? []) add(p)
    for (const p of bot.runDiff?.changed ?? []) add(p)
    return out.slice(0, 12)
  }

  function applyAssistant(bot: BotRecord, parts: Map<string, string>): void {
    const combined = stripThinking([...parts.values()].filter(Boolean).join('\n\n'))
    if (!combined) return
    const last = bot.thread[bot.thread.length - 1]
    if (last?.role === 'assistant') last.text = combined
    else bot.thread.push({ id: newId('m'), role: 'assistant', text: combined, at: Date.now() })
    bot.preview = previewOf(combined)
    queueFlush(bot)
  }

  function peersLine(bot: BotRecord): string {
    const others = store.list().filter((b) => b.id !== bot.id)
    if (!others.length) return ''
    return `\nOther bots you can hand work to with @Name: ${others.map((b) => `@${b.name}`).join(', ')}.`
  }

  function buildSystem(bot: BotRecord, query = ''): string {
    const settings = deps.settings.get()
    const mem = memory.search('', 8, bot.id)
    const ws = workspaceDir()
    const memBlock = mem.length
      ? `\n\nThings this bot has been told to remember:\n${mem.map((m) => `- ${m.key}: ${m.value}`).join('\n')}`
      : ''
    const pending = pendingTurn.get(bot.id)
    const vaultBlock = vault ? vault.contextBlock(bot.id, query, pending ? [pending] : []) : ''
    const job = bot.job.trim() ? `\nYour job: ${bot.job.trim()}` : ''
    const privacy = settings.privacyMode
      ? '\nPrivacy mode is on. Do not copy secrets, tokens, or personal data into logs or outbound drafts.'
      : ''
    return [
      `You are ${bot.name}, a local AI teammate in Red Sky, a Grok Bot–style desktop app.`,
      `You run on OpenCode on this machine. You have a workspace and tools (files, shell, browse).`,
      `Workspace: ${ws}`,
      job,
      connectorPromptBlock(deps.connectors.list()),
      `Do the work yourself. Stay inside the workspace unless a connected tool is required.`,
      `When you finish, give a concise summary of what you did and any files you created.`,
      `Never include hidden reasoning, chain-of-thought, or <think> blocks in the reply. Only the result.`,
      `Never do anything destructive (delete data, send messages, spend money) without asking first.`,
      `If you learn a durable fact, write a line starting with "Noted for next time:" so it is saved.`,
      settings.allowBotHandoff ? peersLine(bot) : '',
      privacy,
      memBlock,
      vaultBlock,
    ]
      .filter(Boolean)
      .join('\n')
  }

  /** Persist one message to the vault. Idempotent — the message id is the key. */
  function recordTurn(bot: BotRecord, msg: ChatMessage): void {
    if (!vault || !msg.text?.trim()) return
    const turn = vault.recordTurn({
      id: msg.id,
      at: safeTime(msg.at),
      role: msg.role,
      text: msg.text,
      botId: bot.id,
      botName: bot.name,
      user: deps.settings.get().userName,
    })
    if (turn && msg.role === 'user') pendingTurn.set(bot.id, turn.id)
  }

  /**
   * Fold every message already in bot threads into the vault, so conversations
   * that predate the vault (or happened before it was wired up) still count as
   * history and become recallable. Idempotent — recorded ids are skipped.
   */
  function importHistory(): number {
    if (!vault) return 0
    const user = deps.settings.get().userName
    let imported = 0
    for (const bot of store.list()) {
      let index = 0
      for (const msg of bot.thread) {
        const text = msg.text?.trim()
        if (!text) continue
        // Deterministic id for old messages that never got one, so a second
        // run cannot duplicate them.
        const id = msg.id ?? `his_${bot.id}_${msg.at ?? 0}_${index}`
        const turn = vault.recordTurn({
          id,
          at: safeTime(msg.at ?? bot.createdAt),
          role: msg.role,
          text: msg.text,
          botId: bot.id,
          botName: bot.name,
          user,
        })
        if (turn) imported++
        index++
      }
    }
    if (imported > 0) vault.note('history.backfill', `Imported ${imported} past messages into the vault.`)
    return imported
  }

  async function createSession(title: string): Promise<string> {
    if (!baseUrl) throw new Error('OpenCode is still starting')
    const session = await api<Record<string, unknown>>('POST', `${baseUrl}/session`, { title })
    const id = String(session.id ?? session.sessionID ?? (session as { session?: { id?: string } }).session?.id ?? '')
    if (!id) throw new Error('OpenCode did not return a session id')
    return id
  }

  async function ensureSession(bot: BotRecord): Promise<string> {
    if (bot.sessionId) return bot.sessionId
    bot.sessionId = await createSession(bot.name)
    botBySession.set(bot.sessionId, bot.id)
    store.upsert(bot)
    return bot.sessionId
  }

  function parseMessages(raw: unknown): ChatMessage[] {
    const list: unknown[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as { messages?: unknown[] }).messages)
        ? (raw as { messages: unknown[] }).messages
        : []
    const out: ChatMessage[] = []
    for (const item of list) {
      const rec = item as { info?: Record<string, unknown>; parts?: unknown[]; role?: string }
      const info: Record<string, unknown> = rec.info ?? (item as Record<string, unknown>)
      const roleRaw = String(info.role ?? rec.role ?? '')
      const role: ChatMessage['role'] = roleRaw === 'user' ? 'user' : 'assistant'
      const parts = Array.isArray(rec.parts)
        ? rec.parts
        : Array.isArray(info.parts)
          ? (info.parts as unknown[])
          : []
      const texts: string[] = []
      for (const p of parts) {
        const part = p as Record<string, unknown>
        if (partLooksLikeThinking(part)) continue
        if (part.type === 'text' && typeof part.text === 'string') texts.push(stripThinking(part.text))
      }
      const text = texts.filter(Boolean).join('\n\n').trim()
      if (text) out.push({ id: newId('m'), role, text, at: safeTime(info.time ?? info.createdAt ?? Date.now()) })
    }
    return out
  }

  async function hydrate(bot: BotRecord): Promise<void> {
    if (!baseUrl || !bot.sessionId) return
    try {
      const msgs = await api<unknown>('GET', `${baseUrl}/session/${bot.sessionId}/message`)
      const thread = parseMessages(msgs)
      if (thread.length) {
        bot.thread = thread
        bot.preview = previewOf(thread.at(-1)?.text ?? bot.preview)
        const s = await api<{ title?: string }>('GET', `${baseUrl}/session/${bot.sessionId}`).catch(() => null)
        if (s?.title && !s.title.startsWith('New session') && bot.name === 'New agent') bot.name = s.title
        store.upsert(bot)
        emitBot(bot)
      }
    } catch {
      /* session may be gone */
    }
  }

  function scheduleHydrate(bot: BotRecord): void {
    const prev = hydrateTimer.get(bot.id)
    if (prev) clearTimeout(prev)
    hydrateTimer.set(
      bot.id,
      setTimeout(() => {
        hydrateTimer.delete(bot.id)
        void hydrate(bot)
      }, 400),
    )
  }

  function harvestAndTeach(bot: BotRecord): void {
    const last = [...bot.thread].reverse().find((m) => m.role === 'assistant')
    if (last?.text) memory.harvestFromText(last.text, bot.id)
    vault?.syncProfile(memory.list())
    if (!bot.watchMode) return
    const prompt = lastUserPrompt(bot.id)
    if (!prompt) return
    events.emit('event', { source: 'teach', botId: bot.id, prompt })
  }

  function handleBusEvent(bot: BotRecord, evt: { type: string; properties?: Record<string, unknown>; data?: unknown }): void {
    const props = (evt.properties ?? {}) as Record<string, unknown>
    switch (evt.type) {
      case 'message.part.updated': {
        const part = props.part as Record<string, unknown> | undefined
        if (!part) return
        if (partLooksLikeThinking(part)) return
        if (part.type === 'text' && part.id) {
          const run = partText.get(bot.id) ?? new Map<string, string>()
          run.set(String(part.id), String(part.text ?? ''))
          partText.set(bot.id, run)
          applyAssistant(bot, run)
        } else if (part.type === 'tool' || part.type === 'file') {
          const state = typeof part.state === 'object' && part.state ? (part.state as Record<string, unknown>) : {}
          const input = typeof state.input === 'object' && state.input ? (state.input as Record<string, unknown>) : {}
          const pick = (v: unknown): string => (typeof v === 'string' ? v : '')
          const title = pick(part.tool) || pick(part.name) || (part.type === 'file' ? 'file' : 'tool')
          const detail = pick(part.path) || pick(state.title) || pick(state.command) || pick(input.command) || pick(part.title) || pick(part.output)
          bot.activity = title
          pushComputer(bot, { kind: part.type === 'file' ? 'file' : 'tool', title, detail, at: Date.now() })
          queueFlush(bot)
        } else if (part.type === 'step-start' || part.type === 'step-finish') {
          bot.activity = undefined
          queueFlush(bot)
        }
        break
      }
      case 'message.part.delta': {
        const partID = String(props.partID ?? '')
        const delta = String(props.delta ?? '')
        if (!partID || !delta) return
        const run = partText.get(bot.id) ?? new Map<string, string>()
        run.set(partID, (run.get(partID) ?? '') + delta)
        partText.set(bot.id, run)
        applyAssistant(bot, run)
        break
      }
      case 'permission.asked': {
        const perm = (props.permission ?? props) as Record<string, unknown>
        const id = String(perm.id ?? props.permissionID ?? '')
        if (!id) return
        bot.status = 'waiting'
        bot.pendingPermission = {
          id,
          title: String(perm.permission ?? perm.type ?? 'Permission needed'),
          detail: String(perm.metadata ? JSON.stringify(perm.metadata) : perm.pattern ?? perm.patterns ?? 'This action needs your approval.'),
        }
        store.upsert(bot)
        emitBot(bot)
        audit('permission.asked', { botId: bot.id, permissionId: id })
        break
      }
      case 'message.error':
      case 'session.error': {
        const err = (evt.data ?? props) as { message?: string }
        bot.status = 'error'
        bot.error = err?.message ?? 'OpenCode message error'
        bot.updatedAt = Date.now()
        store.upsert(bot)
        emitBot(bot)
        break
      }
      case 'session.idle': {
        bot.status = 'idle'
        bot.pendingPermission = undefined
        bot.activity = undefined
        bot.updatedAt = Date.now()
        const before = snaps.get(bot.id) ?? []
        snaps.delete(bot.id)
        bot.runDiff = diffSnaps(before, snapshotWorkspace())
        bot.artifacts = collectArtifacts(bot)
        store.upsert(bot)
        partText.delete(bot.id)
        emitBot(bot)
        // The run is over, so the trailing assistant text is final — now it is
        // safe to write it to the vault (during streaming it is still partial).
        for (const msg of bot.thread.slice(-8)) {
          if (msg.role === 'assistant') recordTurn(bot, msg)
        }
        pendingTurn.delete(bot.id)
        harvestAndTeach(bot)
        scheduleHydrate(bot)
        break
      }
      default:
        break
    }
  }

  function attach(liveBaseUrl: string): void {
    baseUrl = liveBaseUrl
    if (attached) return
    attached = true
    serverEvents.on('event', (evt: { type: string; properties?: Record<string, unknown>; data?: unknown }) => {
      const sid = sessionIdOf(evt)
      if (!sid) return
      const botId = botBySession.get(sid)
      const bot = botId ? store.get(botId) : undefined
      if (!bot) return
      handleBusEvent(bot, evt)
    })
  }

  async function createBot(input?: { name?: string; job?: string }): Promise<BotRecord> {
    if (!baseUrl) throw new Error('OpenCode is still starting')
    const n = store.list().length
    const name = (input?.name || 'New agent').trim()
    const now = Date.now()
    const sessionId = await createSession(name)
    // Once the user has dragged agents into a manual order, a freshly created agent
    // should still land on top rather than at the bottom of the pinned/unpinned group.
    const orders = store
      .list()
      .map((b) => b.order)
      .filter((o): o is number => typeof o === 'number')
    const bot: BotRecord = {
      id: newId('bot'),
      name,
      job: input?.job?.trim() ?? '',
      hue: HUES[n % HUES.length],
      sessionId,
      status: 'idle',
      preview: '',
      thread: [],
      computer: [],
      createdAt: now,
      updatedAt: now,
      ...(orders.length ? { order: Math.min(...orders) - 1 } : {}),
    }
    botBySession.set(sessionId, bot.id)
    store.upsert(bot)
    emitBot(bot)
    audit('bot.create', { botId: bot.id, name })
    vault?.note('agent.create', `${name}${bot.job ? ` — ${bot.job}` : ''}`, { id: bot.id, name: bot.name })
    return snapshot(bot)
  }

  async function renameBot(botId: string, name: string, job?: string): Promise<BotRecord> {
    const bot = store.get(botId)
    if (!bot) throw new Error('bot not found')
    bot.name = name.trim() || bot.name
    if (job !== undefined) bot.job = job
    bot.updatedAt = Date.now()
    store.upsert(bot)
    if (baseUrl && bot.sessionId) {
      await api('PATCH', `${baseUrl}/session/${bot.sessionId}`, { title: bot.name }).catch(() => undefined)
    }
    emitBot(bot)
    return snapshot(bot)
  }

  async function duplicateBot(botId: string): Promise<BotRecord> {
    const bot = store.get(botId)
    if (!bot) throw new Error('bot not found')
    return createBot({ name: `${bot.name} copy`, job: bot.job })
  }

  function setBotFlags(botId: string, flags: { pinned?: boolean; archived?: boolean }): BotRecord {
    const bot = store.get(botId)
    if (!bot) throw new Error('bot not found')
    if (flags.pinned !== undefined) bot.pinned = flags.pinned
    if (flags.archived !== undefined) bot.archived = flags.archived
    bot.updatedAt = Date.now()
    store.upsert(bot)
    emitBot(bot)
    return snapshot(bot)
  }

  // Persists the sidebar order. Reordering is a view concern, so updatedAt is left
  // untouched (bumping it would make reordered agents look recently active).
  function reorderBots(orderedIds: string[]): BotRecord[] {
    const rank = new Map(orderedIds.map((id, i) => [id, i] as const))
    const changed: BotRecord[] = []
    for (const bot of store.list()) {
      const next = rank.get(bot.id)
      if (next === undefined || bot.order === next) continue
      bot.order = next
      store.upsert(bot)
      changed.push(bot)
    }
    for (const bot of changed) emitBot(bot)
    return changed.map(snapshot)
  }

  async function branchFrom(botId: string, prompt: string, model?: ModelRef): Promise<BotRecord> {
    const src = store.get(botId)
    if (!src) throw new Error('bot not found')
    const last = [...src.thread].reverse().find((m) => m.role === 'assistant')
    const child = await createBot({ name: `${src.name} · take`, job: src.job })
    const live = store.get(child.id)
    if (!live) return child
    live.parentId = src.id
    live.hue = src.hue
    store.upsert(live)
    const ctx = last?.text ? `Previous result:\n${last.text.slice(0, 1800)}\n\nNew take: ${prompt}` : prompt
    return send(live.id, { text: ctx, model, internal: true })
  }

  function search(query: string): SearchHit[] {
    return searchWorkspaceFiles(query)
  }

  function applyReminderTurn(bot: BotRecord, userText: string, assistantText: string): BotRecord {
    const userMsg: ChatMessage = { id: newId('m'), role: 'user', text: userText, at: Date.now() }
    const botMsg: ChatMessage = { id: newId('m'), role: 'assistant', text: assistantText, at: Date.now(), kind: 'chat' }
    bot.thread.push(userMsg, botMsg)
    recordTurn(bot, userMsg)
    recordTurn(bot, botMsg)
    bot.preview = previewOf(assistantText)
    bot.status = 'idle'
    bot.error = undefined
    bot.updatedAt = Date.now()
    store.upsert(bot)
    emitBot(bot)
    return snapshot(bot)
  }

  function nudgeReminder(botId: string, prompt: string): BotRecord | undefined {
    const bot = store.get(botId)
    if (!bot) return undefined
    const reminderMsg: ChatMessage = {
      id: newId('m'),
      role: 'assistant',
      text: prompt,
      at: Date.now(),
      kind: 'reminder',
    }
    bot.thread.push(reminderMsg)
    recordTurn(bot, reminderMsg)
    let extra = bot.thread.filter((m) => m.kind === 'reminder').length - 40
    if (extra > 0) {
      bot.thread = bot.thread.filter((m) => {
        if (m.kind === 'reminder' && extra > 0) {
          extra -= 1
          return false
        }
        return true
      })
    }
    bot.preview = previewOf(prompt)
    bot.updatedAt = Date.now()
    store.upsert(bot)
    emitBot(bot)
    return snapshot(bot)
  }

  function touchPreview(bot: BotRecord): void {
    const last = bot.thread.at(-1)
    bot.preview = last ? previewOf(last.text) : ''
    bot.updatedAt = Date.now()
  }

  function patchMessage(botId: string, messageId: string, text: string): BotRecord {
    const bot = store.get(botId)
    if (!bot) throw new Error('bot not found')
    const msg = bot.thread.find((m) => m.id === messageId)
    if (!msg) throw new Error('message not found')
    msg.text = text
    touchPreview(bot)
    store.upsert(bot)
    emitBot(bot)
    return snapshot(bot)
  }

  function deleteMessage(botId: string, messageId: string): BotRecord {
    const bot = store.get(botId)
    if (!bot) throw new Error('bot not found')
    bot.thread = bot.thread.filter((m) => m.id !== messageId)
    touchPreview(bot)
    store.upsert(bot)
    emitBot(bot)
    return snapshot(bot)
  }

  function clearThread(botId: string): BotRecord {
    const bot = store.get(botId)
    if (!bot) throw new Error('bot not found')
    vault?.note('thread.cleared', `Thread cleared for ${bot.name}`, { id: bot.id, name: bot.name })
    bot.thread = []
    bot.computer = []
    bot.preview = ''
    bot.error = undefined
    bot.updatedAt = Date.now()
    store.upsert(bot)
    emitBot(bot)
    return snapshot(bot)
  }

  async function resendFrom(botId: string, messageId: string, model?: ModelRef): Promise<BotRecord> {
    const bot = store.get(botId)
    if (!bot) throw new Error('bot not found')
    const idx = bot.thread.findIndex((m) => m.id === messageId)
    if (idx < 0) throw new Error('message not found')
    const msg = bot.thread[idx]
    if (msg.role !== 'user') throw new Error('resend from a user message')
    const text = msg.text
    bot.thread = bot.thread.slice(0, idx)
    bot.status = 'idle'
    store.upsert(bot)
    return send(botId, { text, model, internal: true })
  }

  async function dispatchPrompt(bot: BotRecord, text: string, model?: ModelRef): Promise<void> {
    const sessionId = await ensureSession(bot)
    const body: Record<string, unknown> = { parts: [{ type: 'text', text }], system: buildSystem(bot, text) }
    const m = model ?? modelRefFrom(bot.model)
    if (m) body.model = m
    await apiEmpty('POST', `${baseUrl}/session/${sessionId}/prompt_async`, body)
  }

  async function send(
    botId: string,
    input: { text: string; model?: ModelRef; roomId?: string; internal?: boolean },
  ): Promise<BotRecord> {
    const bot = store.get(botId)
    if (!bot) throw new Error('bot not found')

    if (!input.internal) {
      if (parseCancelReminder(input.text)) {
        const n = deps.cancelReminders(bot.id)
        const msg =
          n > 0
            ? `Stopped ${n} reminder${n === 1 ? '' : 's'} on this agent. You will not get those pings anymore.`
            : 'No reminders were running on this agent.'
        return applyReminderTurn(bot, input.text, msg)
      }
      const rem = parseReminder(input.text)
      if (rem) {
        deps.scheduleReminder(bot.id, rem.schedule, rem.task)
        const when = reminderLabel(rem.schedule)
        return applyReminderTurn(
          bot,
          input.text,
          `On it. I will remind you to **${rem.task}** ${when}.\nYou get a desktop notification and a ping in this chat. Say **stop reminding me** to cancel.`,
        )
      }
    }

    if (bot.status === 'running') throw new Error('this bot is still working')
    if (!baseUrl) throw new Error('OpenCode is still starting')

    const settings = deps.settings.get()
    const running = store.list().filter((b) => b.status === 'running').length
    if (running >= settings.maxParallelBots) {
      throw new Error(`already running ${running} bots (max ${settings.maxParallelBots})`)
    }

    if (input.roomId) {
      const room = deps.rooms.get(input.roomId)
      if (room && !bot.roomIds?.includes(room.id)) {
        bot.roomIds = [...(bot.roomIds ?? []), room.id]
      }
      deps.rooms.touch(input.roomId, input.text)
      events.emit('event', { source: 'rooms', rooms: deps.rooms.list() })
    }

    if (!input.internal && settings.allowBotHandoff) {
      const { mentions, remainder } = parseMentions(input.text, store.list())
      const others = mentions.filter((m) => m.botId !== bot.id)
      if (others.length) {
        const tail = bot.thread
          .slice(-6)
          .map((m) => `${m.role}: ${m.text}`)
          .join('\n')
          .slice(0, 2000)
        for (const hit of others) {
          const peer = store.get(hit.botId)
          if (!peer || peer.status === 'running') continue
          pushComputer(bot, {
            kind: 'handoff',
            title: `Asking ${hit.name}…`,
            detail: remainder || input.text,
            at: Date.now(),
          })
          const prompt = buildHandoffPrompt({
            fromName: bot.name,
            fromJob: bot.job,
            remainder: remainder || input.text,
            threadTail: tail,
          })
          await send(hit.botId, { text: prompt, model: input.model, roomId: input.roomId, internal: true })
        }
        const askMsg: ChatMessage = { id: newId('m'), role: 'user', text: input.text, at: Date.now() }
        const handoffMsg: ChatMessage = {
          id: newId('m'),
          role: 'assistant',
          text: `Handed off to ${others.map((o) => o.name).join(', ')}. You can keep watching this thread.`,
          at: Date.now(),
        }
        bot.thread.push(askMsg, handoffMsg)
        recordTurn(bot, askMsg)
        recordTurn(bot, handoffMsg)
        bot.preview = previewOf(`Asking ${others[0].name}…`)
        bot.updatedAt = Date.now()
        store.upsert(bot)
        emitBot(bot)
        if (!mentions.some((m) => m.botId === bot.id)) return snapshot(bot)
      }
    }

    if (!input.internal && needsHumanReview(input.text, settings.autoReview)) {
      const reason = reviewReason(input.text) ?? 'Auto Review is on for this kind of work.'
      queued.set(bot.id, { text: input.text, model: input.model, roomId: input.roomId })
      bot.status = 'waiting'
      bot.pendingPermission = {
        id: `policy_${newId('p')}`,
        title: 'Auto Review',
        detail: reason,
      }
      const heldMsg: ChatMessage = { id: newId('m'), role: 'user', text: input.text, at: Date.now() }
      bot.thread.push(heldMsg)
      recordTurn(bot, heldMsg)
      bot.preview = previewOf(input.text)
      bot.updatedAt = Date.now()
      store.upsert(bot)
      emitBot(bot)
      audit('policy.hold', { botId: bot.id, reason })
      return snapshot(bot)
    }

    if (input.model) bot.model = `${input.model.providerID}\u241f${input.model.modelID}`
    const promptMsg: ChatMessage = { id: newId('m'), role: 'user', text: input.text, at: Date.now() }
    bot.thread.push(promptMsg)
    recordTurn(bot, promptMsg)
    bot.preview = previewOf(input.text)
    bot.status = 'running'
    bot.error = undefined
    bot.pendingPermission = undefined
    bot.updatedAt = Date.now()
    botBySession.set(await ensureSession(bot), bot.id)
    partText.delete(bot.id)
    // Capture the workspace before the run so session.idle can diff against it
    // and report only the files this run touched.
    snaps.set(bot.id, snapshotWorkspace())
    store.upsert(bot)
    emitBot(bot)

    try {
      await dispatchPrompt(bot, input.text, input.model)
    } catch (err) {
      bot.status = 'error'
      bot.error = (err as Error).message
      store.upsert(bot)
      emitBot(bot)
      throw err
    }
    return snapshot(bot)
  }

  async function abort(botId: string): Promise<void> {
    const bot = store.get(botId)
    if (!bot || bot.status !== 'running') return
    try {
      await api<boolean>('POST', `${baseUrl}/session/${bot.sessionId}/abort`)
    } catch {
      /* server will settle */
    }
    bot.status = 'idle'
    bot.updatedAt = Date.now()
    store.upsert(bot)
    partText.delete(bot.id)
    pendingTurn.delete(bot.id)
    emitBot(bot)
  }

  async function deleteBot(botId: string): Promise<void> {
    const bot = store.get(botId)
    store.delete(botId)
    partText.delete(botId)
    queued.delete(botId)
    pendingTurn.delete(botId)
    if (bot?.sessionId) {
      botBySession.delete(bot.sessionId)
      if (baseUrl) await api('DELETE', `${baseUrl}/session/${bot.sessionId}`).catch(() => undefined)
    }
    events.emit('event', { source: 'deleted', botId })
    audit('bot.delete', { botId })
  }

  async function respondPermission(botId: string, permissionId: string, response: 'once' | 'always' | 'reject'): Promise<void> {
    const bot = store.get(botId)
    if (!bot) throw new Error('bot not found')
    if (permissionId.startsWith('policy_')) {
      const held = queued.get(botId)
      queued.delete(botId)
      bot.pendingPermission = undefined
      if (response === 'reject' || !held) {
        bot.status = 'idle'
        store.upsert(bot)
        emitBot(bot)
        return
      }
      if (response === 'always') deps.settings.update({ autoReview: 'off' })
      bot.status = 'idle'
      store.upsert(bot)
      await send(botId, { ...held, internal: true })
      return
    }
    await api('POST', `${baseUrl}/session/${bot.sessionId}/permissions/${permissionId}`, { response })
    bot.pendingPermission = undefined
    bot.status = response === 'reject' ? 'idle' : 'running'
    store.upsert(bot)
    emitBot(bot)
  }

  function setWatchMode(botId: string, enabled: boolean): BotRecord {
    const bot = store.get(botId)
    if (!bot) throw new Error('bot not found')
    bot.watchMode = enabled
    bot.updatedAt = Date.now()
    store.upsert(bot)
    emitBot(bot)
    return snapshot(bot)
  }

  function attachRoom(botId: string, roomId: string): void {
    const bot = store.get(botId)
    if (!bot) return
    bot.roomIds = [...new Set([...(bot.roomIds ?? []), roomId])]
    bot.updatedAt = Date.now()
    store.upsert(bot)
    emitBot(bot)
  }

  function lastUserPrompt(botId: string): string | undefined {
    const bot = store.get(botId)
    const msg = [...(bot?.thread ?? [])].reverse().find((m) => m.role === 'user' && !m.text.startsWith('[handoff'))
    return msg?.text
  }

  async function listFiles(rel = '.'): Promise<Array<{ name: string; path: string; type?: string }>> {
    if (!baseUrl) return []
    const q = encodeURIComponent(rel)
    const nodes = await api<unknown>('GET', `${baseUrl}/file?path=${q}`).catch(() => [])
    if (!Array.isArray(nodes)) return []
    return nodes.map((n) => {
      const r = n as Record<string, unknown>
      return { name: String(r.name ?? r.path ?? ''), path: String(r.path ?? r.name ?? ''), type: r.type ? String(r.type) : undefined }
    })
  }

  async function readFile(rel: string): Promise<string> {
    if (!baseUrl) throw new Error('OpenCode is still starting')
    const data = await api<unknown>('GET', `${baseUrl}/file/content?path=${encodeURIComponent(rel)}`)
    if (typeof data === 'string') return data
    const rec = data as Record<string, unknown>
    return String(rec.content ?? rec.text ?? JSON.stringify(data, null, 2))
  }

  return {
    events,
    attach,
    createBot,
    renameBot,
    duplicateBot,
    setBotFlags,
    reorderBots,
    branchFrom,
    send,
    abort,
    deleteBot,
    patchMessage,
    deleteMessage,
    clearThread,
    resendFrom,
    listBots: () => store.list().map(snapshot),
    getBot: (id) => {
      const b = store.get(id)
      return b ? snapshot(b) : undefined
    },
    respondPermission,
    setWatchMode,
    attachRoom,
    lastUserPrompt,
    lifeTip: () => tips.next(),
    warmTips: () => tips.warm(),
    search,
    nudgeReminder,
    importHistory,
    listFiles,
    readFile,
    store,
    memory,
    vault,
  }
}

export { createMemoryStore }
export type { MemoryStore }

import type {
  AppNotice,
  AppSettings,
  Bot,
  Connector,
  ConnectorStatus,
  EventEnvelope,
  InitPayload,
  JobTemplate,
  MemoryRow,
  ModelOption,
  RedSkyApi,
  Room,
  Routine,
} from './types'

const TEMPLATES: JobTemplate[] = [
  { name: 'Sales Outbound', job: 'Generate pipeline overnight.' },
  { name: 'Talent Scout', job: 'Research people and draft intros.' },
  { name: 'Paid Media', job: 'Watch campaigns and leave a review list.' },
  { name: 'Expense Manager', job: 'Organize receipts and draft expense notes.' },
  { name: 'Product Performance', job: 'Track product metrics and write a readout.' },
  { name: 'Bug Reproduction', job: 'Reproduce issues and write a report.' },
  { name: 'Account Health', job: 'Track accounts and draft outreach.' },
  { name: 'Chief of Staff', job: 'Coordinate work across other bots.' },
]

const DEMO_TIPS: string[] = [
  'Small steps repeated daily beat big plans you never start.',
  'Protect one hour of deep focus before the world wakes up.',
  'Name the next physical action — vagueness is what stalls you.',
  'Spend on things that save you time, not things that fill it.',
  'Ask one more question than feels comfortable in every conversation.',
  'Sleep is the cheapest performance upgrade you will ever get.',
]

const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  privacyMode: true,
  autoReview: 'sensitive',
  allowBotHandoff: true,
  maxParallelBots: 8,
  userName: undefined,
}

/** Bumped when the persisted shape changes, so stale snapshots are discarded. */
const STORE_VERSION = 1
const DEFAULT_STORE_KEY = 'redsky.demo.v1'

/** The slice of demo state worth keeping across reloads. */
interface DemoSnapshot {
  version: number
  bots: Bot[]
  settings: AppSettings
  connectors: Connector[]
  rooms: Room[]
  notices: AppNotice[]
  memories: MemoryRow[]
}

/** localStorage survives reloads but private mode forbids access; treat every call as fallible. */
function resolveStorage(persist: boolean | undefined): Storage | null {
  if (persist === false || typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** What a responder sees when it is asked to reply to a prompt. */
export interface DemoRespondInput {
  bot: Bot
  text: string
  model?: string
  roomId?: string
}

/**
 * Produces the assistant's reply for a `send`. Returning a string appends it to
 * the thread as an assistant message. The desktop build never passes this (the
 * real bridge answers over IPC/SSE); the web build passes a Groq-backed one.
 */
export type DemoResponder = (input: DemoRespondInput) => Promise<string>

export interface DemoApiOptions {
  respond?: DemoResponder
  /** Persist agents, threads, settings, rooms, and connectors to localStorage. Defaults to on in the browser. */
  persist?: boolean
  /** Override the localStorage key (e.g. to isolate demos). Defaults to `redsky.demo.v1`. */
  storageKey?: string
}

export function createDemoApi(opts: DemoApiOptions = {}): RedSkyApi {
const HUES = ['#54B9A6', '#F19D38', '#6464EF', '#885CF5', '#3C82F6', '#ED712E', '#EC4899', '#10B981']
// Date.now() alone collides when several agents are created within the same
// millisecond (rapid clicks, or tests). A per-process counter keeps ids unique.
let idSeq = 0
const demoId = (): string => `demo_${Date.now().toString(36)}_${(idSeq++).toString(36)}`
const now = Date.now()
  const storage = resolveStorage(opts.persist)
  const storageKey = opts.storageKey ?? DEFAULT_STORE_KEY

  const loadSnapshot = (): DemoSnapshot | null => {
    if (!storage) return null
    try {
      const raw = storage.getItem(storageKey)
      if (!raw) return null
      const parsed = JSON.parse(raw) as DemoSnapshot
      if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.bots)) return null
      return parsed
    } catch {
      return null
    }
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  const persist = (): void => {
    if (!storage) return
    const snapshot: DemoSnapshot = { version: STORE_VERSION, bots, settings, connectors, rooms, notices, memories }
    try {
      storage.setItem(storageKey, JSON.stringify(snapshot))
    } catch {
      /* quota exceeded or storage disabled — keep working in memory */
    }
  }
  const scheduleSave = (): void => {
    if (!storage) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(persist, 120)
  }

  const seeded = loadSnapshot()
  // A bot caught mid-run or awaiting approval can't resume after a reload.
  const rehydrate = (b: Bot): Bot =>
    b.status === 'running' || b.pendingPermission ? { ...b, status: 'idle', pendingPermission: undefined } : b

  const seedBots: Bot[] = seeded?.bots.length
    ? seeded.bots
    : [
        {
          id: 'demo_chief',
          name: 'Chief',
          job: TEMPLATES[7].job,
          hue: HUES[0],
          sessionId: 's1',
          status: 'idle',
          preview: 'booked the venue and sent the confirmation around.',
          thread: [
            { id: 'm1', role: 'user', text: 'Book the offsite venue and send the confirmation.' },
            { id: 'm2', role: 'assistant', text: 'Booked the venue and sent the confirmation around.' },
          ],
          computer: [],
          createdAt: now - 3600_000,
          updatedAt: now - 60_000,
        },
      ]
  let bots: Bot[] = seedBots.map(rehydrate)
  let settings: AppSettings = { ...DEFAULT_SETTINGS, ...(seeded?.settings ?? {}) }
  let connectors: Connector[] = seeded?.connectors.length
    ? seeded.connectors
    : [
        { id: 'browser', name: 'Browser', description: 'Use sites the way you would.', status: 'disconnected', updatedAt: now },
        { id: 'slack', name: 'Slack', description: 'Search threads and draft replies.', status: 'disconnected', updatedAt: now },
      ]
  let rooms: Room[] = seeded?.rooms ?? []
  let notices: AppNotice[] = seeded?.notices ?? []
  let memories: MemoryRow[] = seeded?.memories?.length ? seeded.memories : []
  const listeners = new Set<(evt: EventEnvelope) => void>()
  const emit = (evt: EventEnvelope) => {
    scheduleSave()
    listeners.forEach((cb) => cb(evt))
  }

  // The live bridge hands the renderer freshly-cloned objects, so React sees new
  // references on every change. This adapter must do the same: mutating in place
  // leaves the object identity untouched and memoized selectors never re-run.
  const patchBot = (bot: Bot, patch: Partial<Bot>): Bot => {
    const next: Bot = { ...bot, ...patch }
    bots = bots.map((b) => (b.id === next.id ? next : b))
    emit({ source: 'bot', bot: next })
    return next
  }
  const models: ModelOption[] = [{ id: 'demo', label: 'Local', isDefault: true }]

  // Mirror the desktop store: once a manual order exists, new agents land on top.
  const topOrder = (): { order?: number } => {
    const orders = bots.map((b) => b.order).filter((o): o is number => typeof o === 'number')
    return orders.length ? { order: Math.min(...orders) - 1 } : {}
  }

  return {
    init: async (): Promise<InitPayload> => ({
      status: 'online',
      baseUrl: null,
      workspace: '',
      logs: '',
      models,
      bots,
      memories,
      routines: [],
      templates: TEMPLATES,
      connectors,
      rooms,
      notices,
      settings,
      runtime: 'opencode',
    }),
    models: async () => models,
    createBot: async (payload) => {
      const bot: Bot = {
        id: demoId(),
        name: payload?.name || 'New agent',
        job: payload?.job || '',
        hue: HUES[bots.length % HUES.length],
        sessionId: '',
        status: 'idle',
        preview: '',
        thread: [],
        computer: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...topOrder(),
      }
      bots = [bot, ...bots]
      emit({ source: 'bot', bot })
      return bot
    },
    renameBot: async (botId, payload) => {
      const bot = bots.find((b) => b.id === botId)!
      return patchBot(bot, { name: payload.name, ...(payload.job !== undefined ? { job: payload.job } : {}) })
    },
    duplicateBot: async (botId) => {
      const src = bots.find((b) => b.id === botId)!
      const bot: Bot = {
        id: demoId(),
        name: `${src.name} copy`,
        job: src.job,
        hue: HUES[bots.length % HUES.length],
        sessionId: '',
        status: 'idle',
        preview: '',
        thread: [],
        computer: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...topOrder(),
      }
      bots = [bot, ...bots]
      emit({ source: 'bot', bot })
      return bot
    },
    setBotFlags: async (botId, flags) => {
      const bot = bots.find((b) => b.id === botId)!
      return patchBot(bot, {
        ...(flags.pinned !== undefined ? { pinned: flags.pinned } : {}),
        ...(flags.archived !== undefined ? { archived: flags.archived } : {}),
        updatedAt: Date.now(),
      })
    },
    reorderBots: async (orderedIds) => {
      orderedIds.forEach((id, i) => {
        const bot = bots.find((b) => b.id === id)
        if (bot && bot.order !== i) patchBot(bot, { order: i })
      })
      return bots
    },
    branchFrom: async (botId, messageId) => {
      const src = bots.find((b) => b.id === botId)!
      const asked = [...src.thread].reverse().find((m) => m.id === messageId && m.role === 'user')
      const bot: Bot = {
        id: demoId(),
        name: `${src.name} · take`,
        job: src.job,
        hue: src.hue,
        sessionId: '',
        status: 'idle',
        preview: '',
        thread: asked ? [{ id: `m_${Date.now()}`, role: 'user', text: asked.text, at: Date.now() }] : [],
        computer: [],
        parentId: src.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...topOrder(),
      }
      bots = [bot, ...bots]
      emit({ source: 'bot', bot })
      return bot
    },
    // The browser demo has no workspace to search.
    search: async () => [],
    // No model in the plain demo — serve a rotating sample tip.
    lifeTip: async () => DEMO_TIPS[Math.floor(Math.random() * DEMO_TIPS.length)],
    send: async (botId, payload) => {
      const bot = bots.find((b) => b.id === botId)!
      let next = patchBot(bot, {
        thread: [...bot.thread, { id: `m_${Date.now()}`, role: 'user', text: payload.text, at: Date.now() }],
        preview: payload.text,
        updatedAt: Date.now(),
      })

      if (!opts.respond) return next

      next = patchBot(next, { status: 'running', error: undefined })
      try {
        const reply = await opts.respond({ bot: next, text: payload.text, model: payload.model, roomId: payload.roomId })
        next = patchBot(next, {
          thread: [...next.thread, { id: `m_${Date.now()}_a`, role: 'assistant', text: reply, at: Date.now() }],
          preview: reply,
          status: 'idle',
          updatedAt: Date.now(),
        })
      } catch (err) {
        const message = (err as Error).message || 'Request failed'
        next = patchBot(next, { status: 'error', error: message, preview: message, updatedAt: Date.now() })
      }
      return next
    },
    abortBot: async () => ({ ok: true }),
    listBots: async () => bots,
    deleteBot: async (botId) => {
      bots = bots.filter((b) => b.id !== botId)
      emit({ source: 'deleted', botId })
      return { ok: true }
    },
    patchMessage: async (botId, messageId, text) => {
      const bot = bots.find((b) => b.id === botId)!
      return patchBot(bot, { thread: bot.thread.map((m) => (m.id === messageId ? { ...m, text } : m)) })
    },
    deleteMessage: async (botId, messageId) => {
      const bot = bots.find((b) => b.id === botId)!
      return patchBot(bot, { thread: bot.thread.filter((m) => m.id !== messageId) })
    },
    clearThread: async (botId) => {
      const bot = bots.find((b) => b.id === botId)!
      return patchBot(bot, { thread: [], preview: '' })
    },
    resendFrom: async (botId, messageId) => {
      const bot = bots.find((b) => b.id === botId)!
      const idx = bot.thread.findIndex((m) => m.id === messageId)
      const msg = bot.thread[idx]
      return patchBot(bot, {
        thread: [...bot.thread.slice(0, idx), { id: `m_${Date.now()}`, role: 'user', text: msg?.text ?? '', at: Date.now() }],
      })
    },
    permission: async () => ({ ok: true }),
    files: async () => [],
    fileContent: async () => '',
    listMemories: async (botId) =>
      memories
        .filter((m) => !botId || !m.botId || m.botId === botId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((m) => ({ ...m })),
    addMemory: async (payload) => {
      const now = Date.now()
      const row: MemoryRow = {
        id: `mem_${now}_${Math.random().toString(36).slice(2, 6)}`,
        key: payload.key,
        value: payload.value,
        botId: payload.botId,
        createdAt: now,
        updatedAt: now,
      }
      memories = [row, ...memories]
      scheduleSave()
      return row
    },
    deleteMemory: async (id) => {
      memories = memories.filter((m) => m.id !== id)
      scheduleSave()
      return { ok: true }
    },
    clearMemories: async () => {
      memories = []
      scheduleSave()
      return { ok: true }
    },
    listHistory: async () =>
      bots
        .flatMap((b) =>
          (b.thread ?? [])
            .filter((m) => m.text?.trim())
            .map((m, i) => ({
              id: m.id ?? `${b.id}_${m.at ?? 0}_${i}`,
              at: m.at ?? b.createdAt,
              role: m.role === 'system' ? ('system' as const) : m.role,
              text: m.text,
              botId: b.id,
              botName: b.name,
              user: settings.userName,
            })),
        )
        .sort((a, b) => a.at - b.at)
        .reverse(),
    listRoutines: async () => [] as Routine[],
    addRoutine: async (payload) => ({ id: `${Date.now()}`, ...payload, enabled: true }),
    removeRoutine: async () => ({ ok: true }),
    toggleRoutine: async () => ({ ok: true }),
    teachRoutine: async (payload) => ({
      id: `${Date.now()}`,
      botId: payload.botId,
      schedule: payload.schedule,
      prompt: 'taught task',
      enabled: true,
      origin: 'taught',
    }),
    setWatchMode: async (botId, enabled) => {
      const bot = bots.find((b) => b.id === botId)!
      return patchBot(bot, { watchMode: enabled })
    },
    listConnectors: async () => connectors,
    updateConnector: async (payload) => {
      const row = connectors.find((c) => c.id === payload.id)!
      const next: Connector = { ...row, status: payload.status as ConnectorStatus, note: payload.note }
      connectors = connectors.map((c) => (c.id === next.id ? next : c))
      emit({ source: 'connectors', connectors })
      return next
    },
    listRooms: async () => rooms,
    createRoom: async (payload) => {
      const room: Room = {
        id: `room_${Date.now()}`,
        title: payload.title ?? 'Thread',
        participantIds: payload.participantIds,
        preview: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      rooms = [room, ...rooms]
      emit({ source: 'rooms', rooms })
      return room
    },
    addToRoom: async (roomId, botId) => {
      const room = rooms.find((r) => r.id === roomId)!
      const next: Room = room.participantIds.includes(botId)
        ? room
        : { ...room, participantIds: [...room.participantIds, botId] }
      rooms = rooms.map((r) => (r.id === next.id ? next : r))
      emit({ source: 'rooms', rooms })
      return next
    },
    renameRoom: async (roomId, title) => {
      const room = rooms.find((r) => r.id === roomId)!
      const next: Room = { ...room, title }
      rooms = rooms.map((r) => (r.id === next.id ? next : r))
      emit({ source: 'rooms', rooms })
      return next
    },
    deleteRoom: async (roomId) => {
      rooms = rooms.filter((r) => r.id !== roomId)
      emit({ source: 'rooms', rooms })
      return { ok: true }
    },
    listNotices: async () => notices,
    markNoticeRead: async (id) => {
      notices = notices.map((n) => (n.id === id ? { ...n, read: true } : n))
      scheduleSave()
      return notices
    },
    markAllNoticesRead: async () => {
      notices = notices.map((n) => ({ ...n, read: true }))
      scheduleSave()
      return notices
    },
    clearNotices: async () => {
      notices = []
      emit({ source: 'notices', notices })
      return { ok: true }
    },
    getSettings: async () => settings,
    updateSettings: async (patch) => {
      settings = { ...settings, ...patch, version: 1 }
      emit({ source: 'settings', settings })
      return settings
    },
    openWorkspace: async () => ({ ok: true }),
    openLogs: async () => ({ ok: true }),
    setupCheck: async () => ({
      appVersion: '0.2.0-dev',
      platform: 'demo',
      opencode: { found: true },
      models: 1,
      status: 'online',
      bots: bots.length,
      routines: 0,
      memories: 0,
      logTailRedacted: '(demo)',
    }),
    openFeedback: async () => ({ ok: true }),
    windowMinimize: () => undefined,
    windowMaximize: () => undefined,
    windowClose: () => undefined,
    onEvent: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}

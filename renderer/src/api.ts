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
  ReviewMode,
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

const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  privacyMode: true,
  autoReview: 'sensitive',
  allowBotHandoff: true,
  maxParallelBots: 8,
}

function demoApi(): RedSkyApi {
  const HUES = ['#54B9A6', '#F19D38', '#6464EF', '#885CF5', '#3C82F6', '#ED712E', '#EC4899', '#10B981']
  const now = Date.now()
  let bots: Bot[] = [
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
  let settings = { ...DEFAULT_SETTINGS }
  let connectors: Connector[] = [
    { id: 'browser', name: 'Browser', description: 'Use sites the way you would.', status: 'disconnected', updatedAt: now },
    { id: 'slack', name: 'Slack', description: 'Search threads and draft replies.', status: 'disconnected', updatedAt: now },
  ]
  let rooms: Room[] = []
  let notices: AppNotice[] = []
  const listeners = new Set<(evt: EventEnvelope) => void>()
  const emit = (evt: EventEnvelope) => listeners.forEach((cb) => cb(evt))
  const models: ModelOption[] = [{ id: 'demo', label: 'Local', isDefault: true }]

  return {
    init: async (): Promise<InitPayload> => ({
      status: 'online',
      baseUrl: null,
      workspace: '',
      logs: '',
      models,
      bots,
      memories: [],
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
        id: `demo_${Date.now()}`,
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
      }
      bots = [bot, ...bots]
      emit({ source: 'bot', bot })
      return bot
    },
    renameBot: async (botId, payload) => {
      const bot = bots.find((b) => b.id === botId)!
      bot.name = payload.name
      if (payload.job !== undefined) bot.job = payload.job
      emit({ source: 'bot', bot })
      return bot
    },
    duplicateBot: async (botId) => {
      const src = bots.find((b) => b.id === botId)!
      const bot: Bot = {
        id: `demo_${Date.now()}`,
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
      }
      bots = [bot, ...bots]
      emit({ source: 'bot', bot })
      return bot
    },
    setBotFlags: async (botId, flags) => {
      const bot = bots.find((b) => b.id === botId)!
      if (flags.pinned !== undefined) bot.pinned = flags.pinned
      if (flags.archived !== undefined) bot.archived = flags.archived
      bot.updatedAt = Date.now()
      emit({ source: 'bot', bot })
      return bot
    },
    branchFrom: async (botId, messageId) => {
      const src = bots.find((b) => b.id === botId)!
      const asked = [...src.thread].reverse().find((m) => m.id === messageId && m.role === 'user')
      const bot: Bot = {
        id: `demo_${Date.now()}`,
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
      }
      bots = [bot, ...bots]
      emit({ source: 'bot', bot })
      return bot
    },
    // The browser demo has no workspace to search.
    search: async () => [],
    send: async (botId, payload) => {
      const bot = bots.find((b) => b.id === botId)!
      bot.thread.push({ id: `m_${Date.now()}`, role: 'user', text: payload.text, at: Date.now() })
      bot.preview = payload.text
      bot.updatedAt = Date.now()
      emit({ source: 'bot', bot })
      return bot
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
      const msg = bot.thread.find((m) => m.id === messageId)
      if (msg) msg.text = text
      emit({ source: 'bot', bot })
      return bot
    },
    deleteMessage: async (botId, messageId) => {
      const bot = bots.find((b) => b.id === botId)!
      bot.thread = bot.thread.filter((m) => m.id !== messageId)
      emit({ source: 'bot', bot })
      return bot
    },
    clearThread: async (botId) => {
      const bot = bots.find((b) => b.id === botId)!
      bot.thread = []
      bot.preview = ''
      emit({ source: 'bot', bot })
      return bot
    },
    resendFrom: async (botId, messageId) => {
      const bot = bots.find((b) => b.id === botId)!
      const idx = bot.thread.findIndex((m) => m.id === messageId)
      const msg = bot.thread[idx]
      bot.thread = bot.thread.slice(0, idx)
      bot.thread.push({ id: `m_${Date.now()}`, role: 'user', text: msg?.text ?? '', at: Date.now() })
      emit({ source: 'bot', bot })
      return bot
    },
    permission: async () => ({ ok: true }),
    files: async () => [],
    fileContent: async () => '',
    listMemories: async () => [],
    addMemory: async (payload) =>
      ({ id: `${Date.now()}`, key: payload.key, value: payload.value, createdAt: Date.now(), updatedAt: Date.now() }) as MemoryRow,
    deleteMemory: async () => ({ ok: true }),
    clearMemories: async () => ({ ok: true }),
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
      bot.watchMode = enabled
      emit({ source: 'bot', bot })
      return bot
    },
    listConnectors: async () => connectors,
    updateConnector: async (payload) => {
      const row = connectors.find((c) => c.id === payload.id)!
      row.status = payload.status as ConnectorStatus
      row.note = payload.note
      emit({ source: 'connectors', connectors })
      return row
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
      if (!room.participantIds.includes(botId)) room.participantIds.push(botId)
      emit({ source: 'rooms', rooms })
      return room
    },
    renameRoom: async (roomId, title) => {
      const room = rooms.find((r) => r.id === roomId)!
      room.title = title
      emit({ source: 'rooms', rooms })
      return room
    },
    deleteRoom: async (roomId) => {
      rooms = rooms.filter((r) => r.id !== roomId)
      emit({ source: 'rooms', rooms })
      return { ok: true }
    },
    listNotices: async () => notices,
    markNoticeRead: async (id) => {
      const n = notices.find((x) => x.id === id)
      if (n) n.read = true
      return notices
    },
    markAllNoticesRead: async () => {
      notices.forEach((n) => {
        n.read = true
      })
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
    windowMinimize: () => undefined,
    windowMaximize: () => undefined,
    windowClose: () => undefined,
    onEvent: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
}

export const api: RedSkyApi = window.redsky ?? demoApi()

export type { ReviewMode }

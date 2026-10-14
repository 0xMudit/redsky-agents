/** Canonical domain types shared by the Electron main process and the renderer. */

import type {
  CloudComputer,
  CloudRuntimeStatus,
  DeviceClient,
  DevicePlatform,
  FederatedFact,
  Handoff,
  Recording,
  RecordingStep,
} from './cloud'

export type {
  CloudComputer,
  CloudRuntimeStatus,
  ComputerState,
  CloudRuntimeKind,
  CloudRuntimeState,
  DeviceClient,
  DevicePlatform,
  FederatedFact,
  Handoff,
  HandoffState,
  Recording,
  RecordingState,
  RecordingStep,
} from './cloud'

export type BotStatus = 'idle' | 'running' | 'error' | 'waiting'
export type ReviewMode = 'always' | 'sensitive' | 'off'
export type ConnectorStatus = 'disconnected' | 'connected' | 'error'
export type BootState = 'starting' | 'online' | 'offline'

export interface ChatMessage {
  id?: string
  role: 'user' | 'assistant' | 'system'
  text: string
  at?: number
  fromBotId?: string
  toBotId?: string
  kind?: 'chat' | 'reminder'
}

export type NoticeKind = 'done' | 'waiting' | 'error' | 'handoff' | 'digest' | 'reminder'

export interface AppNotice {
  id: string
  kind: NoticeKind
  botId: string
  title: string
  body: string
  at: number
  read: boolean
}

export interface Artifact {
  path: string
  title: string
}

export interface RunDiff {
  added: string[]
  changed: string[]
  removed: string[]
  at: number
}

export interface SearchHit {
  id: string
  kind: 'agent' | 'message' | 'memory' | 'file'
  title: string
  snippet: string
  botId?: string
  path?: string
}

export interface ComputerEvent {
  id: string
  kind: 'tool' | 'file' | 'shell' | 'note' | 'handoff' | 'review'
  title: string
  detail: string
  at: number
}

export interface PendingPermission {
  id: string
  title: string
  detail: string
}

export interface Bot {
  id: string
  name: string
  job: string
  hue: string
  sessionId: string
  model?: string
  status: BotStatus
  error?: string
  preview: string
  thread: ChatMessage[]
  computer: ComputerEvent[]
  pendingPermission?: PendingPermission
  roomIds?: string[]
  watchMode?: boolean
  pinned?: boolean
  archived?: boolean
  order?: number
  parentId?: string
  activity?: string
  runDiff?: RunDiff
  artifacts?: Artifact[]
  createdAt: number
  updatedAt: number
}

export interface MemoryRow {
  id: string
  key: string
  value: string
  botId?: string
  sourceTaskId?: string
  createdAt: number
  updatedAt: number
}

export interface ModelOption {
  id: string
  label: string
  isDefault: boolean
  providerID?: string
}

export interface Routine {
  id: string
  botId: string
  schedule: string
  prompt: string
  enabled: boolean
  lastRun?: number
  origin?: 'manual' | 'taught' | 'reminder'
}

export interface JobTemplate {
  name: string
  job: string
}

export interface FileNode {
  name: string
  path: string
  type?: string
}

export interface Connector {
  id: string
  name: string
  description: string
  status: ConnectorStatus
  note?: string
  updatedAt: number
}

export interface Room {
  id: string
  title: string
  participantIds: string[]
  preview: string
  createdAt: number
  updatedAt: number
}

/** A user-authored note (Notion-style). Body is markdown. */
export interface Note {
  id: string
  title: string
  body: string
  tags: string[]
  pinned: boolean
  /** Where the note came from, e.g. 'manual' or 'selection'. */
  source?: string
  botId?: string
  createdAt: number
  updatedAt: number
}

/** Lightweight search result for notes (full-text). */
export interface NoteHit {
  id: string
  title: string
  snippet: string
  tags: string[]
  updatedAt: number
  score: number
}

export interface AppSettings {
  version: 1
  privacyMode: boolean
  autoReview: ReviewMode
  allowBotHandoff: boolean
  maxParallelBots: number
  defaultModel?: string
  speakResults?: boolean
  lastDigestAt?: number
  /** Who is talking to the agents. Every recorded turn is tagged with it. */
  userName?: string
}

/** One recorded message in the per-user conversation history. */
export interface HistoryTurn {
  id: string
  at: number
  role: 'user' | 'assistant' | 'system'
  text: string
  botId: string
  botName: string
  user?: string
}

export interface InitPayload {
  status: BootState
  baseUrl: string | null
  workspace: string
  logs: string
  models: ModelOption[]
  bots: Bot[]
  memories: MemoryRow[]
  routines: Routine[]
  templates: JobTemplate[]
  connectors: Connector[]
  rooms: Room[]
  notes: Note[]
  notices: AppNotice[]
  settings: AppSettings
  runtime: 'opencode'
  /** Cloud capability state — see docs/FEATURES-CLOUD.md. */
  cloud: CloudRuntimeStatus
  computers: CloudComputer[]
  devices: DeviceClient[]
  recordings: Recording[]
  handoffs: Handoff[]
  federated: FederatedFact[]
}

/** First-run prerequisites the renderer renders as ✓/✗. */
export interface SetupCheck {
  appVersion: string
  platform: string
  opencode: { found: boolean; path?: string }
  models: number
  status: BootState
  bots: number
  routines: number
  memories: number
  logTailRedacted: string
}

export type EventEnvelope =
  | { source: 'status'; state: BootState; detail?: string }
  | { source: 'bot'; bot: Bot }
  | { source: 'deleted'; botId: string }
  | { source: 'settings'; settings: AppSettings }
  | { source: 'connectors'; connectors: Connector[] }
  | { source: 'rooms'; rooms: Room[] }
  | { source: 'notes'; notes: Note[] }
  | { source: 'teach'; botId: string; prompt: string }
  | { source: 'notice'; notice: AppNotice }
  | { source: 'notices'; notices: AppNotice[] }
  | { source: 'routines'; routines: Routine[] }
  | { source: 'cloud'; cloud: CloudRuntimeStatus }
  | { source: 'computers'; computers: CloudComputer[] }
  | { source: 'devices'; devices: DeviceClient[] }
  | { source: 'recordings'; recordings: Recording[] }
  | { source: 'handoffs'; handoffs: Handoff[] }
  | { source: 'federated'; facts: FederatedFact[] }

export interface RedSkyApi {
  init: () => Promise<InitPayload>
  models: () => Promise<ModelOption[]>
  createBot: (payload?: { name?: string; job?: string }) => Promise<Bot>
  renameBot: (botId: string, payload: { name: string; job?: string }) => Promise<Bot>
  duplicateBot: (botId: string) => Promise<Bot>
  setBotFlags: (botId: string, flags: { pinned?: boolean; archived?: boolean }) => Promise<Bot>
  reorderBots: (orderedIds: string[]) => Promise<Bot[]>
  branchFrom: (botId: string, messageId: string, model?: string) => Promise<Bot>
  search: (query: string) => Promise<SearchHit[]>
  lifeTip: () => Promise<string>
  send: (botId: string, payload: { text: string; model?: string; roomId?: string; attachments?: string[] }) => Promise<Bot>
  abortBot: (botId: string) => Promise<{ ok: boolean }>
  listBots: () => Promise<Bot[]>
  deleteBot: (botId: string) => Promise<{ ok: boolean }>
  patchMessage: (botId: string, messageId: string, text: string) => Promise<Bot>
  deleteMessage: (botId: string, messageId: string) => Promise<Bot>
  clearThread: (botId: string) => Promise<Bot>
  resendFrom: (botId: string, messageId: string, model?: string) => Promise<Bot>
  permission: (payload: {
    botId: string
    permissionId: string
    response: 'once' | 'always' | 'reject'
  }) => Promise<{ ok: boolean }>
  files: (rel?: string) => Promise<FileNode[]>
  fileContent: (rel: string) => Promise<string>
  /** Copy uploaded files into the workspace inbox and return their workspace-relative paths. */
  importFiles: (files: { name: string; data: Uint8Array }[]) => Promise<string[]>
  listMemories: (botId?: string) => Promise<MemoryRow[]>
  addMemory: (payload: { key: string; value: string; botId?: string }) => Promise<MemoryRow>
  deleteMemory: (id: string) => Promise<{ ok: boolean }>
  clearMemories: () => Promise<{ ok: boolean }>
  listHistory: () => Promise<HistoryTurn[]>
  listRoutines: () => Promise<Routine[]>
  addRoutine: (payload: {
    botId: string
    schedule: string
    prompt: string
    origin?: 'manual' | 'taught' | 'reminder'
  }) => Promise<Routine>
  removeRoutine: (id: string) => Promise<{ ok: boolean }>
  toggleRoutine: (id: string, enabled: boolean) => Promise<{ ok: boolean }>
  teachRoutine: (payload: { botId: string; schedule: string }) => Promise<Routine>
  setWatchMode: (botId: string, enabled: boolean) => Promise<Bot>
  listConnectors: () => Promise<Connector[]>
  updateConnector: (payload: { id: string; status: ConnectorStatus; note?: string }) => Promise<Connector>
  listRooms: () => Promise<Room[]>
  createRoom: (payload: { title?: string; participantIds: string[] }) => Promise<Room>
  addToRoom: (roomId: string, botId: string) => Promise<Room>
  renameRoom: (roomId: string, title: string) => Promise<Room>
  deleteRoom: (roomId: string) => Promise<{ ok: boolean }>
  // Notes — see docs.
  listNotes: (opts?: { limit?: number }) => Promise<Note[]>
  searchNotes: (query: string, opts?: { limit?: number }) => Promise<NoteHit[]>
  getNote: (id: string) => Promise<Note | undefined>
  createNote: (payload: {
    title?: string
    body?: string
    tags?: string[]
    pinned?: boolean
    source?: string
    botId?: string
  }) => Promise<Note>
  updateNote: (
    id: string,
    patch: { title?: string; body?: string; tags?: string[]; pinned?: boolean },
  ) => Promise<Note>
  appendToNote: (id: string, text: string) => Promise<Note>
  deleteNote: (id: string) => Promise<{ ok: boolean }>
  listNotices: () => Promise<AppNotice[]>
  markNoticeRead: (id: string) => Promise<AppNotice[]>
  markAllNoticesRead: () => Promise<AppNotice[]>
  clearNotices: () => Promise<{ ok: boolean }>
  getSettings: () => Promise<AppSettings>
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
  // Cloud capabilities — see docs/FEATURES-CLOUD.md.
  cloudStatus: () => Promise<CloudRuntimeStatus>
  listComputers: () => Promise<CloudComputer[]>
  ensureComputer: (botId: string) => Promise<CloudComputer>
  stopComputer: (botId: string) => Promise<CloudComputer>
  listDevices: () => Promise<DeviceClient[]>
  registerDevice: (payload: { name: string; platform: DevicePlatform; push?: boolean }) => Promise<DeviceClient>
  removeDevice: (id: string) => Promise<{ ok: boolean }>
  listRecordings: (botId?: string) => Promise<Recording[]>
  startRecording: (payload: { botId: string; title?: string }) => Promise<Recording>
  captureRecording: (id: string, step: Omit<RecordingStep, 'at'>) => Promise<Recording>
  stopRecording: (id: string) => Promise<Recording>
  saveRecordingAsRoutine: (payload: { id: string; schedule: string }) => Promise<Routine>
  listHandoffs: (botId?: string) => Promise<Handoff[]>
  queueHandoff: (payload: { fromBotId: string; toBotId: string; prompt: string }) => Promise<Handoff>
  listFederated: (botId?: string) => Promise<FederatedFact[]>
  publishFact: (payload: { key: string; value: string; botId?: string }) => Promise<FederatedFact>
  forgetFact: (id: string) => Promise<{ ok: boolean }>
  openWorkspace: () => Promise<{ ok: boolean }>
  openLogs: () => Promise<{ ok: boolean }>
  setupCheck: () => Promise<SetupCheck>
  openFeedback: () => Promise<{ ok: boolean }>
  windowMinimize: () => void
  windowMaximize: () => void
  windowClose: () => void
  onEvent: (cb: (evt: EventEnvelope) => void) => () => void
}

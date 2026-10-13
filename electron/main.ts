import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron'
import * as path from 'node:path'
import { autoUpdater } from 'electron-updater'
import { createAgent, JOB_TEMPLATES, type AgentHandle } from './agent'
import { audit } from './audit'
import { createConnectorStore } from './connectors'
import { createComputerStore } from './cloud/computer'
import { createDeviceStore } from './cloud/devices'
import { buildHandoffPrompt } from './collab'
import { createFederationStore } from './cloud/federation'
import { createHandoffStore, reciprocalInFlight } from './cloud/handoff'
import { captureRecordingSteps, createRecordingStore, draftRoutineFromRecording } from './cloud/recording'
import { createLocalRuntime } from './cloud/runtime'
import { createLogger } from './lib/logger'
import { listModels } from './models'
import { createNoticeStore } from './notices'
import { logsDir, workspaceDir } from './paths'
import { createRoomStore } from './rooms'
import { createScheduler, type SchedulerHandle } from './scheduler'
import { startServer, serverEvents, stop as stopServer } from './server'
import { createSettingsStore } from './settings'
import { tools } from './tools'
import { createVault } from './vault'
import { checkOpenCode, composeFeedbackUrl, redactedLogTail } from './beta'
import { previewOf } from '../shared/visible'
import type { ModelRef } from './http'
import type { AppSettings, Bot, ConnectorStatus, EventEnvelope, NoticeKind } from '../shared/types'
import type { DevicePlatform, Handoff, RecordingStep } from '../shared/cloud'

let mainWindow: BrowserWindow | null = null
let baseUrl = ''
let agent: AgentHandle | null = null
let scheduler: SchedulerHandle | null = null
let settingsStore: ReturnType<typeof createSettingsStore> | undefined
let connectorStore: ReturnType<typeof createConnectorStore> | undefined
let roomStore: ReturnType<typeof createRoomStore> | undefined
let noticeStore: ReturnType<typeof createNoticeStore> | undefined
let vaultStore: ReturnType<typeof createVault> | undefined
let computerStore: ReturnType<typeof createComputerStore> | undefined
let deviceStore: ReturnType<typeof createDeviceStore> | undefined
let recordingStore: ReturnType<typeof createRecordingStore> | undefined
let handoffStore: ReturnType<typeof createHandoffStore> | undefined
let federationStore: ReturnType<typeof createFederationStore> | undefined
const cloudRuntime = createLocalRuntime()
const lastBotStatus = new Map<string, Bot['status']>()
// Live recording capture: per-bot cursor of which feed events a running
// recording has already turned into steps. Seeded when recording starts so only
// new activity is captured, then diffed on every bot event.
const recCursors = new Map<string, { id: string; seenComputer: Set<string>; seenThread: Set<string> }>()
// Auto-dispatched handoffs: which handoff a bot is currently working on, so its
// completion can be marked when the bot goes idle again.
const dispatchedHandoff = new Map<string, string>()
const log = createLogger()

function settings(): ReturnType<typeof createSettingsStore> {
  return (settingsStore ??= createSettingsStore())
}
function connectors(): ReturnType<typeof createConnectorStore> {
  return (connectorStore ??= createConnectorStore())
}
function rooms(): ReturnType<typeof createRoomStore> {
  return (roomStore ??= createRoomStore())
}
function notices(): ReturnType<typeof createNoticeStore> {
  return (noticeStore ??= createNoticeStore())
}
function vault(): ReturnType<typeof createVault> {
  return (vaultStore ??= createVault())
}
function computers(): ReturnType<typeof createComputerStore> {
  return (computerStore ??= createComputerStore())
}
function devices(): ReturnType<typeof createDeviceStore> {
  return (deviceStore ??= createDeviceStore())
}
function recordings(): ReturnType<typeof createRecordingStore> {
  return (recordingStore ??= createRecordingStore())
}
function handoffs(): ReturnType<typeof createHandoffStore> {
  return (handoffStore ??= createHandoffStore())
}
function federation(): ReturnType<typeof createFederationStore> {
  return (federationStore ??= createFederationStore())
}

/** Reflect a runtime state change to the status bar and the cloud panel. */
function setCloudState(state: Parameters<typeof cloudRuntime.markState>[0], detail?: string): void {
  cloudRuntime.markState(state, detail)
  broadcast({ source: 'cloud', cloud: cloudRuntime.status() })
}

function pushNotice(bot: Bot, kind: NoticeKind, title: string, body: string, alwaysOs = false): void {
  const notice = notices().add({ kind, botId: bot.id, title, body })
  broadcast({ source: 'notice', notice })
  const focused = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused())
  if ((alwaysOs || !focused) && Notification.isSupported()) {
    new Notification({ title, body: body.slice(0, 180) }).show()
  }
}

/** Fold new activity on an actively-recorded bot into its recording. */
function captureForRecording(bot: Bot): void {
  const active = recordings().active(bot.id)
  const cursor = recCursors.get(bot.id)
  if (!active) {
    if (cursor) recCursors.delete(bot.id)
    return
  }
  const state =
    cursor && cursor.id === active.id
      ? cursor
      : { id: active.id, seenComputer: new Set<string>(), seenThread: new Set<string>() }
  recCursors.set(bot.id, state)
  const steps = captureRecordingSteps({
    computer: bot.computer,
    thread: bot.thread,
    seenComputer: state.seenComputer,
    seenThread: state.seenThread,
  })
  if (!steps.length) return
  for (const step of steps) {
    try {
      recordings().capture(active.id, step)
    } catch {
      /* the recording was stopped under us */
    }
  }
  broadcast({ source: 'recordings', recordings: recordings().list() })
}

/** Launch a queued handoff at its target, once the target is free. */
function dispatchHandoff(row: Handoff): void {
  const a = agent
  if (!a) return
  const target = a.getBot(row.toBotId)
  if (!target || target.status === 'running') return
  const from = a.getBot(row.fromBotId)
  const tail = (from?.thread ?? [])
    .slice(-6)
    .map((m) => `${m.role}: ${m.text}`)
    .join('\n')
    .slice(0, 2000)
  const prompt = buildHandoffPrompt({
    fromName: from?.name ?? 'another bot',
    fromJob: from?.job ?? '',
    remainder: row.prompt,
    threadTail: tail,
  })
  handoffs().transition(row.id, 'accepted')
  dispatchedHandoff.set(target.id, row.id)
  broadcast({ source: 'handoffs', handoffs: handoffs().list() })
  void a.send(target.id, { text: prompt, internal: true }).catch((err) => {
    handoffs().transition(row.id, 'failed', (err as Error).message)
    if (dispatchedHandoff.get(target.id) === row.id) dispatchedHandoff.delete(target.id)
    broadcast({ source: 'handoffs', handoffs: handoffs().list() })
  })
}

/** Send the next handoff waiting on a now-idle bot, if auto-handoff is on. */
function drainQueuedHandoffs(botId: string): void {
  if (!settings().get().allowBotHandoff) return
  if (dispatchedHandoff.has(botId)) return
  const next = handoffs().list(botId).find((h) => h.toBotId === botId && h.state === 'queued')
  if (next) dispatchHandoff(next)
}

/** Mark the handoff a bot just finished, then pick up anything queued behind it. */
function completeDispatchedHandoff(bot: Bot): void {
  const id = dispatchedHandoff.get(bot.id)
  if (id) {
    dispatchedHandoff.delete(bot.id)
    const done = handoffs().transition(id, 'done')
    broadcast({ source: 'handoffs', handoffs: handoffs().list() })
    const from = agent?.getBot(done.fromBotId)
    if (from) pushNotice(from, 'handoff', `${bot.name} finished the handoff`, previewOf(done.prompt) || 'Handoff complete')
  }
  drainQueuedHandoffs(bot.id)
}

function onAgentEvent(evt: EventEnvelope): void {
  broadcast(evt)
  if (evt.source !== 'bot') return
  const bot = evt.bot
  captureForRecording(bot)
  const prev = lastBotStatus.get(bot.id)
  lastBotStatus.set(bot.id, bot.status)
  if (prev === 'running' && bot.status === 'idle') {
    const last = [...bot.thread].reverse().find((m) => m.role === 'assistant')
    pushNotice(bot, 'done', `${bot.name} is back`, previewOf(last?.text || 'Done.') || 'Done.')
    completeDispatchedHandoff(bot)
  } else if (bot.status === 'waiting' && prev !== 'waiting') {
    pushNotice(bot, 'waiting', `${bot.name} needs you`, bot.pendingPermission?.title || 'Waiting on you')
  } else if (bot.status === 'error' && prev !== 'error') {
    pushNotice(bot, 'error', `${bot.name} hit an error`, bot.error || 'Something failed')
  }
}

/**
 * Returns the best available app icon for the current platform.
 * Falls back gracefully if build/ icons were not generated — Electron will
 * use its default icon rather than crashing.
 */
function resolveAppIcon(): string | undefined {
  const buildDir = path.join(__dirname, '..', 'build')
  const candidates =
    process.platform === 'darwin'
      ? [path.join(buildDir, 'icon.icns'), path.join(buildDir, 'icon.png')]
      : process.platform === 'win32'
        ? [path.join(buildDir, 'icon.ico'), path.join(buildDir, 'icon.png')]
        : [path.join(buildDir, 'icon.png')]
  const { existsSync } = require('node:fs') as typeof import('node:fs')
  return candidates.find(existsSync)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#141412',
    title: 'Red Sky',
    icon: resolveAppIcon(),
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'))
}

function broadcast(evt: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('rs:event', evt)
  }
}

function parseModel(encoded?: string): ModelRef | undefined {
  if (!encoded) return undefined
  const sep = encoded.indexOf('\u241f')
  if (sep <= 0) return undefined
  const providerID = encoded.slice(0, sep)
  const modelID = encoded.slice(sep + 1)
  return providerID && modelID ? { providerID, modelID } : undefined
}

function requireAgent(): AgentHandle {
  if (!agent) throw new Error('app is still starting')
  return agent
}

function wireIpc(): void {
  ipcMain.handle('rs:init', async () => {
    const a = requireAgent()
    const models = baseUrl ? await listModels(baseUrl) : []
    return {
      status: baseUrl ? 'online' : 'starting',
      baseUrl: baseUrl || null,
      workspace: workspaceDir(),
      logs: logsDir(),
      models,
      bots: a.listBots(),
      memories: a.memory.list(),
      routines: scheduler?.rows() ?? [],
      templates: JOB_TEMPLATES,
      connectors: connectors().list(),
      rooms: rooms().list(),
      notices: notices().list(),
      settings: settings().get(),
      runtime: 'opencode',
      cloud: cloudRuntime.status(),
      computers: computers().list(),
      devices: devices().list(),
      recordings: recordings().list(),
      handoffs: handoffs().list(),
      federated: federation().list(),
    }
  })

  ipcMain.handle('rs:models', async () => listModels(baseUrl))

  ipcMain.handle('rs:createBot', async (_e, payload?: { name?: string; job?: string }) => requireAgent().createBot(payload))

  ipcMain.handle('rs:renameBot', async (_e, botId: string, payload: { name: string; job?: string }) =>
    requireAgent().renameBot(botId, payload.name, payload.job),
  )

  ipcMain.handle('rs:duplicateBot', async (_e, botId: string) => requireAgent().duplicateBot(botId))

  ipcMain.handle('rs:setBotFlags', async (_e, botId: string, flags: { pinned?: boolean; archived?: boolean }) =>
    requireAgent().setBotFlags(botId, flags ?? {}),
  )

  ipcMain.handle('rs:reorderBots', async (_e, orderedIds: string[]) => requireAgent().reorderBots(Array.isArray(orderedIds) ? orderedIds : []))

  ipcMain.handle('rs:branchFrom', async (_e, botId: string, messageId: string, model?: string) => {
    const a = requireAgent()
    const message = a.getBot(botId)?.thread.find((m) => m.id === messageId)
    if (!message) throw new Error('message not found')
    // Branching from a result means a fresh take on the ask that produced it, so the
    // prompt is resolved here rather than trusted from the renderer.
    const prompt = message.role === 'user' ? message.text : a.lastUserPrompt(botId) || message.text
    if (!prompt.trim()) throw new Error('nothing to branch from yet — send a task first')
    return a.branchFrom(botId, prompt, parseModel(model))
  })

  ipcMain.handle('rs:search', async (_e, query: string) => (query?.trim() ? requireAgent().search(query.trim()) : []))

  ipcMain.handle('rs:lifeTip', async () => requireAgent().lifeTip())

  ipcMain.handle('rs:send', async (_e, botId: string, payload: { text: string; model?: string; roomId?: string }) => {
    if (!payload?.text?.trim()) throw new Error('empty prompt')
    if (!baseUrl) throw new Error('OpenCode is still starting')
    return requireAgent().send(botId, { text: payload.text, model: parseModel(payload.model), roomId: payload.roomId })
  })

  ipcMain.handle('rs:abortBot', async (_e, botId: string) => {
    await requireAgent().abort(botId)
    return { ok: true }
  })

  ipcMain.handle('rs:listBots', async () => requireAgent().listBots())

  ipcMain.handle('rs:deleteBot', async (_e, botId: string) => {
    await requireAgent().deleteBot(botId)
    return { ok: true }
  })

  ipcMain.handle('rs:patchMessage', async (_e, botId: string, messageId: string, text: string) => {
    if (!text?.trim()) throw new Error('empty message')
    return requireAgent().patchMessage(botId, messageId, text.trim())
  })
  ipcMain.handle('rs:deleteMessage', async (_e, botId: string, messageId: string) => requireAgent().deleteMessage(botId, messageId))
  ipcMain.handle('rs:clearThread', async (_e, botId: string) => requireAgent().clearThread(botId))
  ipcMain.handle('rs:resendFrom', async (_e, botId: string, messageId: string, model?: string) =>
    requireAgent().resendFrom(botId, messageId, parseModel(model)),
  )

  ipcMain.handle('rs:permission', async (_e, payload: { botId: string; permissionId: string; response: 'once' | 'always' | 'reject' }) => {
    await requireAgent().respondPermission(payload.botId, payload.permissionId, payload.response)
    return { ok: true }
  })

  ipcMain.handle('rs:files', async (_e, rel?: string) => {
    // Try the OpenCode /file endpoint first; fall back to the local workspace walker
    // if it returns nothing (endpoint not supported in this OpenCode version) or errors.
    try {
      const nodes = await requireAgent().listFiles(rel)
      if (nodes.length > 0) return nodes
    } catch {
      /* fall through to local */
    }
    // Local fallback: read the workspace directory directly
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs')
    const { workspaceDir: wsDir } = require('./paths') as typeof import('./paths')
    try {
      const base = rel && rel !== '.' ? path.join(wsDir(), rel) : wsDir()
      const entries = readdirSync(base, { withFileTypes: true })
      return entries
        .filter((e) => !e.name.startsWith('.') || e.name === '.env.example')
        .map((e) => ({
          name: e.name,
          path: rel && rel !== '.' ? `${rel}/${e.name}` : e.name,
          type: e.isDirectory() ? 'directory' : 'file',
        }))
    } catch {
      return []
    }
  })

  ipcMain.handle('rs:fileContent', async (_e, rel: string) => {
    // Try OpenCode /file/content endpoint first; fall back to reading the workspace file directly.
    try {
      return await requireAgent().readFile(rel)
    } catch {
      /* fall through to local */
    }
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const { workspaceDir: wsDir } = require('./paths') as typeof import('./paths')
    const abs = path.resolve(wsDir(), path.normalize(rel).replace(/^[/\\]+/, ''))
    // Ensure the resolved path stays inside the workspace (path traversal guard).
    // Must include path.sep suffix to prevent workspace-evil/ bypassing startsWith().
    if (abs !== wsDir() && !abs.startsWith(wsDir() + path.sep)) throw new Error('path escapes workspace')
    return readFileSync(abs, 'utf8')
  })

  ipcMain.handle('rs:listMemories', async (_e, botId?: string) => requireAgent().memory.list(botId))

  ipcMain.handle('rs:listHistory', async (_e, user?: string) =>
    vault()
      .turns()
      .filter((t) => !user || t.user === user || !t.user)
      .reverse(),
  )

  ipcMain.handle('rs:addMemory', async (_e, payload: { key: string; value: string; botId?: string }) => {
    if (!payload?.key?.trim() || !payload?.value?.trim()) throw new Error('key and value required')
    const row = requireAgent().memory.add(payload.key.trim(), payload.value.trim(), payload.botId)
    vault().syncProfile(requireAgent().memory.list())
    return row
  })

  ipcMain.handle('rs:deleteMemory', async (_e, id: string) => {
    requireAgent().memory.remove(id)
    vault().syncProfile(requireAgent().memory.list())
    return { ok: true }
  })

  ipcMain.handle('rs:clearMemories', async () => {
    requireAgent().memory.clear()
    vault().syncProfile(requireAgent().memory.list())
    return { ok: true }
  })

  ipcMain.handle('rs:listRoutines', async () => scheduler?.rows() ?? [])
  ipcMain.handle('rs:addRoutine', async (_e, payload: { botId: string; schedule: string; prompt: string; origin?: 'manual' | 'taught' }) => {
    if (!scheduler) throw new Error('scheduler not ready')
    if (!payload.botId || !payload.schedule?.trim() || !payload.prompt?.trim()) throw new Error('bot, schedule, and prompt required')
    return scheduler.add(payload.botId, payload.schedule, payload.prompt, payload.origin)
  })
  ipcMain.handle('rs:removeRoutine', async (_e, id: string) => {
    scheduler?.remove(id)
    return { ok: true }
  })
  ipcMain.handle('rs:toggleRoutine', async (_e, id: string, enabled: boolean) => {
    scheduler?.setEnabled(id, enabled)
    return { ok: true }
  })
  ipcMain.handle('rs:teachRoutine', async (_e, payload: { botId: string; schedule: string }) => {
    if (!scheduler) throw new Error('scheduler not ready')
    const prompt = requireAgent().lastUserPrompt(payload.botId)
    if (!prompt?.trim()) throw new Error('no task to teach yet — send one first')
    return scheduler.add(payload.botId, payload.schedule, prompt, 'taught')
  })
  ipcMain.handle('rs:setWatchMode', async (_e, botId: string, enabled: boolean) => requireAgent().setWatchMode(botId, enabled))

  ipcMain.handle('rs:listConnectors', async () => connectors().list())
  ipcMain.handle('rs:updateConnector', async (_e, payload: { id: string; status: ConnectorStatus; note?: string }) => {
    const row = connectors().upsert(payload.id, payload.status, payload.note)
    broadcast({ source: 'connectors', connectors: connectors().list() })
    return row
  })

  ipcMain.handle('rs:listRooms', async () => rooms().list())
  ipcMain.handle('rs:createRoom', async (_e, payload: { title?: string; participantIds: string[] }) => {
    if (!payload?.participantIds?.length) throw new Error('pick at least one bot')
    const room = rooms().create(payload.title ?? 'Thread', payload.participantIds)
    for (const id of payload.participantIds) requireAgent().attachRoom(id, room.id)
    broadcast({ source: 'rooms', rooms: rooms().list() })
    return room
  })
  ipcMain.handle('rs:addToRoom', async (_e, roomId: string, botId: string) => {
    const room = rooms().addParticipant(roomId, botId)
    requireAgent().attachRoom(botId, room.id)
    broadcast({ source: 'rooms', rooms: rooms().list() })
    return room
  })
  ipcMain.handle('rs:renameRoom', async (_e, roomId: string, title: string) => {
    const room = rooms().rename(roomId, title)
    broadcast({ source: 'rooms', rooms: rooms().list() })
    return room
  })
  ipcMain.handle('rs:deleteRoom', async (_e, roomId: string) => {
    rooms().delete(roomId)
    broadcast({ source: 'rooms', rooms: rooms().list() })
    return { ok: true }
  })

  ipcMain.handle('rs:listNotices', async () => notices().list())
  ipcMain.handle('rs:markNoticeRead', async (_e, id: string) => notices().markRead(id))
  ipcMain.handle('rs:markAllNoticesRead', async () => notices().markAllRead())
  ipcMain.handle('rs:clearNotices', async () => {
    notices().clear()
    broadcast({ source: 'notices', notices: [] })
    return { ok: true }
  })

  ipcMain.handle('rs:getSettings', async () => settings().get())
  ipcMain.handle('rs:updateSettings', async (_e, patch: Partial<AppSettings>) => {
    const next = settings().update(patch)
    broadcast({ source: 'settings', settings: next })
    return next
  })

  // Cloud capabilities — see docs/FEATURES-CLOUD.md. Each mutation broadcasts so
  // every open panel reconciles against the same store.
  ipcMain.handle('rs:cloudStatus', async () => cloudRuntime.status())

  ipcMain.handle('rs:listComputers', async () => computers().list())
  ipcMain.handle('rs:ensureComputer', async (_e, botId: string) => {
    if (!botId?.trim()) throw new Error('bot id required')
    const computer = computers().ensure(botId)
    broadcast({ source: 'computers', computers: computers().list() })
    return computer
  })
  ipcMain.handle('rs:stopComputer', async (_e, botId: string) => {
    if (!botId?.trim()) throw new Error('bot id required')
    const computer = computers().stop(botId)
    broadcast({ source: 'computers', computers: computers().list() })
    return computer
  })

  ipcMain.handle('rs:listDevices', async () => devices().list())
  ipcMain.handle('rs:registerDevice', async (_e, payload: { name: string; platform: DevicePlatform; push?: boolean }) => {
    if (!payload?.name?.trim()) throw new Error('device name required')
    const device = devices().register(payload)
    broadcast({ source: 'devices', devices: devices().list() })
    return device
  })
  ipcMain.handle('rs:removeDevice', async (_e, id: string) => {
    devices().remove(id)
    broadcast({ source: 'devices', devices: devices().list() })
    return { ok: true }
  })

  ipcMain.handle('rs:listRecordings', async (_e, botId?: string) => recordings().list(botId))
  ipcMain.handle('rs:startRecording', async (_e, payload: { botId: string; title?: string }) => {
    if (!payload?.botId?.trim()) throw new Error('bot id required')
    const rec = recordings().start(payload)
    // Seed the cursor with what already exists so the recording captures only
    // what happens from now on, not the backlog already on screen.
    const bot = agent?.getBot(payload.botId)
    recCursors.set(payload.botId, {
      id: rec.id,
      seenComputer: new Set((bot?.computer ?? []).map((c) => c.id).filter((x): x is string => Boolean(x))),
      seenThread: new Set(
        (bot?.thread ?? []).filter((m) => m.role === 'user' && m.id).map((m) => m.id as string),
      ),
    })
    broadcast({ source: 'recordings', recordings: recordings().list() })
    return rec
  })
  ipcMain.handle('rs:captureRecording', async (_e, id: string, step: Omit<RecordingStep, 'at'>) => {
    if (!step?.title?.trim()) throw new Error('recording step needs a title')
    const rec = recordings().capture(id, step)
    broadcast({ source: 'recordings', recordings: recordings().list() })
    return rec
  })
  ipcMain.handle('rs:stopRecording', async (_e, id: string) => {
    const rec = recordings().stop(id)
    recCursors.delete(rec.botId)
    broadcast({ source: 'recordings', recordings: recordings().list() })
    return rec
  })
  ipcMain.handle('rs:saveRecordingAsRoutine', async (_e, payload: { id: string; schedule: string }) => {
    if (!scheduler) throw new Error('scheduler not ready')
    if (!payload?.id || !payload.schedule?.trim()) throw new Error('recording and schedule required')
    const rec = recordings().get(payload.id)
    if (!rec) throw new Error('recording not found')
    const draft = draftRoutineFromRecording(rec, payload.schedule)
    const routine = scheduler.add(draft.botId, draft.schedule, draft.prompt, 'taught')
    recordings().markRoutine(payload.id, routine.id)
    broadcast({ source: 'routines', routines: scheduler.rows() })
    broadcast({ source: 'recordings', recordings: recordings().list() })
    return routine
  })

  ipcMain.handle('rs:listHandoffs', async (_e, botId?: string) => handoffs().list(botId))
  ipcMain.handle('rs:queueHandoff', async (_e, payload: { fromBotId: string; toBotId: string; prompt: string }) => {
    if (!payload?.fromBotId || !payload?.toBotId || !payload?.prompt?.trim()) {
      throw new Error('from bot, to bot, and prompt required')
    }
    const row = handoffs().queue(payload)
    // Loop protection: don't put an A→B→A cycle into flight.
    if (reciprocalInFlight(handoffs().list(), payload.fromBotId, payload.toBotId)) {
      const failed = handoffs().transition(row.id, 'failed', 'cycle: a reciprocal handoff is already in flight')
      broadcast({ source: 'handoffs', handoffs: handoffs().list() })
      return failed
    }
    broadcast({ source: 'handoffs', handoffs: handoffs().list() })
    if (settings().get().allowBotHandoff) dispatchHandoff(row)
    return handoffs().get(row.id) ?? row
  })

  ipcMain.handle('rs:listFederated', async (_e, botId?: string) => federation().list(botId))
  ipcMain.handle('rs:publishFact', async (_e, payload: { key: string; value: string; botId?: string }) => {
    if (!payload?.key?.trim() || !payload?.value?.trim()) throw new Error('key and value required')
    const fact = federation().publish({ key: payload.key, value: payload.value, sourceBotId: payload.botId })
    broadcast({ source: 'federated', facts: federation().list() })
    return fact
  })
  ipcMain.handle('rs:forgetFact', async (_e, id: string) => {
    federation().forget(id)
    broadcast({ source: 'federated', facts: federation().list() })
    return { ok: true }
  })

  ipcMain.handle('rs:tool', async (_e, payload: { name: string; args: unknown[] }) => {
    const fn = (tools as Record<string, unknown>)[payload.name] as ((...a: never[]) => Promise<unknown>) | undefined
    if (!fn) throw new Error(`unknown tool: ${payload.name}`)
    return fn(...(payload.args as never[]))
  })

  ipcMain.handle('rs:openWorkspace', async () => {
    void shell.openPath(workspaceDir())
    return { ok: true }
  })

  ipcMain.handle('rs:openLogs', async () => {
    void shell.openPath(logsDir())
    return { ok: true }
  })

  ipcMain.handle('rs:setupCheck', async () => ({
    appVersion: app.getVersion(),
    platform: process.platform,
    opencode: checkOpenCode(),
    models: baseUrl ? (await listModels(baseUrl)).length : 0,
    status: baseUrl ? 'online' : 'starting',
    bots: agent?.listBots().length ?? 0,
    routines: scheduler?.rows().length ?? 0,
    memories: agent?.memory.list().length ?? 0,
    logTailRedacted: redactedLogTail(),
  }))

  ipcMain.handle('rs:openFeedback', async () => {
    const check = checkOpenCode()
    const models = baseUrl ? await listModels(baseUrl) : []
    const tail = redactedLogTail()
    const url = composeFeedbackUrl({
      appVersion: app.getVersion(),
      platform: process.platform,
      status: baseUrl ? 'online' : 'starting',
      opencode: check,
      models: models.length,
      bots: agent?.listBots().length ?? 0,
      routines: scheduler?.rows().length ?? 0,
      memories: agent?.memory.list().length ?? 0,
      logTailRedacted: tail,
    })
    void shell.openExternal(url)
    return { ok: true }
  })

  ipcMain.on('win:minimize', () => mainWindow?.minimize())
  ipcMain.on('win:maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('win:close', () => mainWindow?.close())
}

serverEvents.on('status', (evt) => broadcast({ source: 'status', ...(evt as object) }))

wireIpc()

app.whenReady().then(async () => {
  log.info('app.ready')
  if (process.platform === 'win32') app.setAppUserModelId('com.redsky.app')
  scheduler = createScheduler((row) => {
    const a = agent
    if (!a) return
    const bot = a.getBot(row.botId) ?? a.listBots()[0]
    if (!bot) return
    if (row.origin === 'reminder') {
      a.nudgeReminder(bot.id, row.prompt)
      pushNotice(bot, 'reminder', `${bot.name} · reminder`, row.prompt, true)
      return
    }
    if (!baseUrl) return
    void a.send(bot.id, { text: `[scheduled ${row.schedule}] ${row.prompt}` }).catch((err) => {
      log.error('routine.failed', { id: row.id, err: (err as Error).message })
    })
  })
  agent = createAgent({
    connectors: connectors(),
    rooms: rooms(),
    settings: settings(),
    vault: vault(),
    federation: federation(),
    scheduleReminder: (botId, schedule, prompt) => {
      const row = scheduler!.add(botId, schedule, prompt, 'reminder')
      broadcast({ source: 'routines', routines: scheduler!.rows() })
      return row
    },
    cancelReminders: (botId) => {
      const n = scheduler!.removeReminders(botId)
      broadcast({ source: 'routines', routines: scheduler!.rows() })
      return n
    },
  })
  agent.events.on('event', (evt) => onAgentEvent(evt as EventEnvelope))
  // Seed the vault (Documents/Red Sky), render the user profile from any
  // durable facts already on disk, and fold existing threads into history so
  // conversations that predate the vault still personalize future runs.
  vault().init()
  vault().syncProfile(agent.memory.list())
  agent.importHistory()
  createWindow()
  broadcast({ source: 'status', state: 'starting', detail: 'starting OpenCode…' })
  setCloudState('starting', 'starting OpenCode…')

  // Auto-updater: only runs in packaged builds, not during `npm start`.
  // Checks GitHub Releases for a newer version; notifies the user silently.
  if (app.isPackaged) {
    autoUpdater.logger = log as Parameters<typeof autoUpdater.setFeedURL>[0] extends never ? never : typeof log
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('update-available', (info) => {
      log.info('update.available', { version: info.version })
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('rs:event', {
          source: 'status',
          state: 'online',
          detail: `Update v${info.version} downloading…`,
        })
      }
    })
    autoUpdater.on('update-downloaded', (info) => {
      log.info('update.downloaded', { version: info.version })
      if (Notification.isSupported()) {
        new Notification({
          title: 'Red Sky update ready',
          body: `v${info.version} will install when you quit the app.`,
        }).show()
      }
    })
    autoUpdater.on('error', (err) => {
      log.error('update.error', { err: (err as Error).message })
    })
    // Check 10s after launch to avoid slowing down startup
    setTimeout(() => void autoUpdater.checkForUpdates(), 10_000)
  }

  // Check for the OpenCode CLI immediately — don't wait 45 s for the timeout to
  // tell the user something they can fix right now.
  const cliCheck = checkOpenCode()
  if (!cliCheck.found) {
    log.warn('opencode.cli.missing', { PATH: process.env.PATH?.slice(0, 200) })
    broadcast({ source: 'status', state: 'offline', detail: 'opencode-missing' })
    setCloudState('offline', 'opencode-missing')
    // Don't attempt to start the server — it will always fail.
    return
  }

  try {
    const handle = await startServer()
    baseUrl = handle.baseUrl
    agent.attach(baseUrl)
    // Have life tips ready before the first send needs one.
    agent.warmTips()
    broadcast({ source: 'status', state: 'online', detail: `opencode · ${baseUrl}` })
    setCloudState('ready', `local · ${baseUrl}`)
    audit('runtime.online', { baseUrl })
  } catch (err) {
    log.error('opencode.start.failed', { err: (err as Error).message })
    serverEvents.emit('status', { state: 'offline', detail: (err as Error).message })
    setCloudState('degraded', (err as Error).message)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  scheduler?.stop()
  void cloudRuntime.stop()
  stopServer()
})

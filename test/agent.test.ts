/**
 * Core agent loop tests.
 *
 * Uses a fake OpenCode HTTP server. Events are pushed via serverEvents (the
 * in-process bus that agent.attach() listens to).
 */

import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import { createAgent, type AgentHandle } from '../electron/agent'
import { createFederationStore } from '../electron/cloud/federation'
import { createConnectorStore } from '../electron/connectors'
import { createRoomStore } from '../electron/rooms'
import { createSettingsStore } from '../electron/settings'
import { createVault } from '../electron/vault'
import { serverEvents } from '../electron/server'
import { startFakeServer, type FakeServer } from './stubs/fake-opencode-server'
import { cleanupTempHomes, drainMicrotasks, useTempHome } from './helpers'

// ── helpers ───────────────────────────────────────────────────────────────────

serverEvents.setMaxListeners(100)

/** Wait for a bot event matching pred, with a fallback timeout. */
function waitForBot(
  agent: AgentHandle,
  pred: (bot: NonNullable<ReturnType<AgentHandle['getBot']>>) => boolean,
  timeoutMs = 2000,
): Promise<NonNullable<ReturnType<AgentHandle['getBot']>>> {
  // Check immediately in case the event already fired
  const bots = agent.listBots()
  const already = bots.find((b) => pred(b))
  if (already) return Promise.resolve(already)

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      agent.events.off('event', handler)
      reject(new Error('waitForBot timed out'))
    }, timeoutMs)
    function handler(evt: unknown) {
      const e = evt as { source: string; bot?: NonNullable<ReturnType<AgentHandle['getBot']>> }
      if (e.source !== 'bot' || !e.bot) return
      if (pred(e.bot)) {
        clearTimeout(timer)
        agent.events.off('event', handler)
        resolve(e.bot)
      }
    }
    agent.events.on('event', handler)
  })
}

// ── fixtures ──────────────────────────────────────────────────────────────────

let srv: FakeServer
let agent: AgentHandle

before(async () => { srv = await startFakeServer() })

after(async () => {
  await srv.stop()
  cleanupTempHomes()
})

beforeEach(() => {
  useTempHome()
  agent = createAgent({
    connectors: createConnectorStore(),
    rooms: createRoomStore(),
    settings: createSettingsStore(),
    scheduleReminder: () => ({ id: 'r_test', botId: '', schedule: '', prompt: '', enabled: true, origin: 'reminder' as const }),
    cancelReminders: () => 0,
  })
  agent.attach(srv.baseUrl)
})

afterEach(() => {
  serverEvents.removeAllListeners('event')
})

// ── createBot ─────────────────────────────────────────────────────────────────

describe('agent — createBot', () => {
  it('creates a session on the fake server and returns a bot', async () => {
    const bot = await agent.createBot({ name: 'Tester', job: 'test things' })
    assert.ok(bot.id)
    assert.equal(bot.name, 'Tester')
    assert.ok(bot.sessionId)
    assert.equal(bot.status, 'idle')
  })

  it('assigns a colour from the HUES palette', async () => {
    const bot = await agent.createBot()
    assert.match(bot.hue, /^#[0-9a-fA-F]{6}$/)
  })
})

// ── reorderBots ───────────────────────────────────────────────────────────────

describe('agent — reorderBots', () => {
  it('assigns a sequential order matching the provided ids', async () => {
    const a = await agent.createBot({ name: 'A' })
    const b = await agent.createBot({ name: 'B' })
    const c = await agent.createBot({ name: 'C' })

    agent.reorderBots([c.id, a.id, b.id])

    assert.equal(agent.getBot(c.id)?.order, 0)
    assert.equal(agent.getBot(a.id)?.order, 1)
    assert.equal(agent.getBot(b.id)?.order, 2)
  })

  it('leaves updatedAt untouched so reordering is not treated as activity', async () => {
    const a = await agent.createBot({ name: 'A' })
    const b = await agent.createBot({ name: 'B' })
    const before = agent.getBot(a.id)?.updatedAt

    agent.reorderBots([b.id, a.id])

    assert.equal(agent.getBot(a.id)?.updatedAt, before)
  })

  it('ignores unknown ids and returns only the changed bots', async () => {
    const a = await agent.createBot({ name: 'A' })
    const b = await agent.createBot({ name: 'B' })
    const changed = agent.reorderBots([a.id, 'bot_missing', b.id])
    assert.equal(changed.length, 2)
    assert.equal(agent.getBot(a.id)?.order, 0)
  })

  it('places a newly created bot on top once a manual order exists', async () => {
    const a = await agent.createBot({ name: 'A' })
    const b = await agent.createBot({ name: 'B' })
    agent.reorderBots([a.id, b.id])
    const fresh = await agent.createBot({ name: 'Fresh' })
    assert.equal(fresh.order, -1)
  })
})

// ── send → prompt dispatched ──────────────────────────────────────────────────

describe('agent — send dispatches prompt', () => {
  it('send() returns a running bot and dispatches prompt_async', async () => {
    const bot = await agent.createBot({ name: 'Runner' })
    const prevCount = srv.prompts.length
    const result = await agent.send(bot.id, { text: 'do something' })
    // send() returns the bot snapshot taken synchronously - status should be running
    assert.equal(result.status, 'running')
    assert.equal(srv.prompts.length, prevCount + 1)
    assert.equal(srv.prompts.at(-1)?.sessionId, bot.sessionId)
  })
})

// ── streaming and idle ────────────────────────────────────────────────────────

describe('agent — streaming and session.idle', () => {
  it('streams delta events into the bot thread', async () => {
    const bot = await agent.createBot({ name: 'Streamer' })
    await agent.send(bot.id, { text: 'stream test' })

    const partId = 'part_1'
    serverEvents.emit('event', { type: 'message.part.delta', properties: { sessionID: bot.sessionId, partID: partId, delta: 'Hello ' } })
    serverEvents.emit('event', { type: 'message.part.delta', properties: { sessionID: bot.sessionId, partID: partId, delta: 'world!' } })
    serverEvents.emit('event', { type: 'session.idle', properties: { sessionID: bot.sessionId } })

    const done = await waitForBot(agent, (b) => b.id === bot.id && b.status === 'idle')
    const reply = done.thread.find((m) => m.role === 'assistant')
    assert.ok(reply, 'assistant message should exist')
    assert.match(reply.text, /Hello world!/)
  })

  it('session.idle sets status to idle and computes runDiff', async () => {
    const bot = await agent.createBot({ name: 'Idler' })
    await agent.send(bot.id, { text: 'finish fast' })

    serverEvents.emit('event', { type: 'session.idle', properties: { sessionID: bot.sessionId } })

    const done = await waitForBot(agent, (b) => b.id === bot.id && b.status === 'idle')
    assert.equal(done.status, 'idle')
    assert.ok(done.runDiff)
    assert.ok(Array.isArray(done.runDiff.added))
  })

  it('message.error sets status to error', async () => {
    const bot = await agent.createBot({ name: 'Errorer' })
    await agent.send(bot.id, { text: 'fail please' })

    serverEvents.emit('event', { type: 'message.error', properties: { sessionID: bot.sessionId }, data: { message: 'model overloaded' } })

    const errored = await waitForBot(agent, (b) => b.id === bot.id && b.status === 'error')
    assert.equal(errored.status, 'error')
    assert.match(errored.error ?? '', /model overloaded/)
  })
})

// ── permission gate ───────────────────────────────────────────────────────────

describe('agent — permission.asked / respondPermission', () => {
  it('permission.asked pauses the bot with pendingPermission', async () => {
    const bot = await agent.createBot({ name: 'AskedBot' })
    await agent.send(bot.id, { text: 'do some work' })

    const permId = 'perm_abc'
    serverEvents.emit('event', {
      type: 'permission.asked',
      properties: {
        sessionID: bot.sessionId,
        permission: { id: permId, permission: 'Run shell command', metadata: { cmd: 'ls' } },
      },
    })

    const waiting = await waitForBot(agent, (b) => b.id === bot.id && b.status === 'waiting')
    assert.equal(waiting.status, 'waiting')
    assert.equal(waiting.pendingPermission?.id, permId)
  })

  it('respondPermission "once" forwards to the server', async () => {
    const bot = await agent.createBot({ name: 'PermBot' })
    await agent.send(bot.id, { text: 'do some work' })

    const permId = 'perm_xyz'
    serverEvents.emit('event', {
      type: 'permission.asked',
      properties: {
        sessionID: bot.sessionId,
        permission: { id: permId, permission: 'Write file', metadata: {} },
      },
    })

    await waitForBot(agent, (b) => b.id === bot.id && b.status === 'waiting')
    await agent.respondPermission(bot.id, permId, 'once')
    await drainMicrotasks()

    const responded = srv.permissions.find((p) => p.permId === permId)
    assert.ok(responded, 'server should have received the permission response')
    assert.equal(responded.body.response, 'once')
  })
})

// ── Auto Review policy gate ───────────────────────────────────────────────────

describe('agent — Auto Review policy gate', () => {
  it('holds a sensitive prompt without hitting the server', async () => {
    const bot = await agent.createBot({ name: 'PolicySensitive' })
    const prevPrompts = srv.prompts.length
    await agent.send(bot.id, { text: 'delete all the old exports' })
    const held = agent.getBot(bot.id)
    assert.equal(held?.status, 'waiting')
    assert.ok(held?.pendingPermission?.id.startsWith('policy_'))
    assert.equal(srv.prompts.length, prevPrompts)
  })

  it('releases a held prompt after "once" approval', async () => {
    const bot = await agent.createBot({ name: 'PolicyRelease' })
    const prevPrompts = srv.prompts.length
    await agent.send(bot.id, { text: 'delete the temp files' })
    const held = agent.getBot(bot.id)
    assert.ok(held?.pendingPermission)
    await agent.respondPermission(bot.id, held.pendingPermission.id, 'once')
    await drainMicrotasks()
    assert.equal(srv.prompts.length, prevPrompts + 1)
  })

  it('"always" mode — reject keeps status idle without server call', async () => {
    const settings = createSettingsStore()
    settings.update({ autoReview: 'always' })
    const a2 = createAgent({
      connectors: createConnectorStore(), rooms: createRoomStore(), settings,
      scheduleReminder: () => ({ id: 'r', botId: '', schedule: '', prompt: '', enabled: true, origin: 'reminder' as const }),
      cancelReminders: () => 0,
    })
    a2.attach(srv.baseUrl)
    const bot = await a2.createBot({ name: 'AlwaysHeld' })
    const prevPrompts = srv.prompts.length
    await a2.send(bot.id, { text: 'summarize the notes' })
    const held = a2.getBot(bot.id)
    assert.equal(held?.status, 'waiting')
    await a2.respondPermission(bot.id, held!.pendingPermission!.id, 'reject')
    await drainMicrotasks()
    assert.equal(srv.prompts.length, prevPrompts)
    assert.equal(a2.getBot(bot.id)?.status, 'idle')
    serverEvents.removeAllListeners('event')
  })
})

// ── abort ─────────────────────────────────────────────────────────────────────

describe('agent — abort', () => {
  it('abort() sets a running bot back to idle', async () => {
    const bot = await agent.createBot({ name: 'Abortable' })
    await agent.send(bot.id, { text: 'run forever' })
    assert.equal(agent.getBot(bot.id)?.status, 'running')
    await agent.abort(bot.id)
    assert.equal(agent.getBot(bot.id)?.status, 'idle')
  })
})

// ── deleteBot ─────────────────────────────────────────────────────────────────

describe('agent — deleteBot', () => {
  it('removes the bot and emits a deleted event', async () => {
    const bot = await agent.createBot({ name: 'Deletable' })
    let deletedId = ''
    agent.events.once('event', (evt: unknown) => {
      const e = evt as { source: string; botId?: string }
      if (e.source === 'deleted') deletedId = e.botId ?? ''
    })
    await agent.deleteBot(bot.id)
    await drainMicrotasks()
    assert.equal(deletedId, bot.id)
    assert.equal(agent.getBot(bot.id), undefined)
  })
})

// ── reminder shortcut ─────────────────────────────────────────────────────────

describe('agent — reminder shortcut', () => {
  it('a reminder prompt is handled locally without hitting the server', async () => {
    const bot = await agent.createBot({ name: 'ReminderBot' })
    const prevPrompts = srv.prompts.length
    const result = await agent.send(bot.id, { text: 'remind me to drink water every 30 minutes' })
    assert.equal(srv.prompts.length, prevPrompts)
    assert.match(result.thread.at(-1)?.text ?? '', /drink water/)
  })
})

// ── parallelism guard ─────────────────────────────────────────────────────────

describe('agent — parallelism guard', () => {
  it('rejects a second send while the bot is already running', async () => {
    const bot = await agent.createBot({ name: 'Busy' })
    await agent.send(bot.id, { text: 'first task' })
    assert.equal(agent.getBot(bot.id)?.status, 'running')
    await assert.rejects(() => agent.send(bot.id, { text: 'second task' }), /still working/)
  })
})

// ── workspace diff ────────────────────────────────────────────────────────────

describe('agent — workspace diff on idle', () => {
  it('runDiff.added contains files created during the run', async () => {
    const bot = await agent.createBot({ name: 'DiffBot' })
    await agent.send(bot.id, { text: 'create a file' })

    const { workspaceDir } = require('../electron/paths') as typeof import('../electron/paths')
    fs.writeFileSync(`${workspaceDir()}/artifact_${Date.now()}.txt`, 'generated')

    serverEvents.emit('event', { type: 'session.idle', properties: { sessionID: bot.sessionId } })

    const done = await waitForBot(agent, (b) => b.id === bot.id && b.status === 'idle')
    assert.ok((done.runDiff?.added.length ?? 0) > 0)
  })

  it('does not report pre-existing workspace files as added', async () => {
    const { workspaceDir } = require('../electron/paths') as typeof import('../electron/paths')
    const preexisting = `preexisting_${Date.now()}.txt`
    fs.writeFileSync(`${workspaceDir()}/${preexisting}`, 'already here before the run')

    const bot = await agent.createBot({ name: 'DiffBotRegress' })
    await agent.send(bot.id, { text: 'add one file' })

    const created = `run_${Date.now()}.txt`
    fs.writeFileSync(`${workspaceDir()}/${created}`, 'written during the run')

    serverEvents.emit('event', { type: 'session.idle', properties: { sessionID: bot.sessionId } })
    const done = await waitForBot(agent, (b) => b.id === bot.id && b.status === 'idle')

    assert.ok(done.runDiff?.added.includes(created), 'file created during the run should be added')
    assert.ok(!done.runDiff?.added.includes(preexisting), 'pre-existing file must not be reported as added')
  })
})

// ── conversation vault ────────────────────────────────────────────────────────

describe('agent — conversation vault', () => {
  it('records exchanges and recalls earlier conversations in the next system prompt', async () => {
    const vault = createVault()
    const a = createAgent({
      connectors: createConnectorStore(),
      rooms: createRoomStore(),
      settings: createSettingsStore(),
      scheduleReminder: () => ({ id: 'r', botId: '', schedule: '', prompt: '', enabled: true, origin: 'reminder' as const }),
      cancelReminders: () => 0,
      vault,
    })
    a.attach(srv.baseUrl)
    const bot = await a.createBot({ name: 'Vaulted' })

    await a.send(bot.id, { text: 'the launch codename is falcon' })
    serverEvents.emit('event', {
      type: 'message.part.delta',
      properties: { sessionID: bot.sessionId, partID: 'vault_p1', delta: 'Noted for next time: launch codename is falcon.' },
    })
    serverEvents.emit('event', { type: 'session.idle', properties: { sessionID: bot.sessionId } })
    await waitForBot(a, (b) => b.id === bot.id && b.status === 'idle')

    // Both the user turn and the finished reply should be on disk.
    assert.equal(vault.turns(bot.id).length, 2)

    // A follow-up question must carry the earlier exchange back into the prompt.
    await a.send(bot.id, { text: 'what is the launch codename again?' })
    const last = srv.prompts.at(-1)?.body as { system?: string } | undefined
    const system = String(last?.system ?? '')
    assert.match(system, /Things you remember about this user/)
    assert.match(system, /Excerpts recalled from earlier conversations/)
    assert.match(system, /falcon/)
  })

  it('importHistory folds pre-existing threads into the vault, tagged with the settings user', async () => {
    const vault = createVault()
    const settings = createSettingsStore()
    settings.update({ userName: 'Mudit' })
    const a = createAgent({
      connectors: createConnectorStore(),
      rooms: createRoomStore(),
      settings,
      scheduleReminder: () => ({ id: 'r', botId: '', schedule: '', prompt: '', enabled: true, origin: 'reminder' as const }),
      cancelReminders: () => 0,
      vault,
    })
    a.attach(srv.baseUrl)
    const bot = await a.createBot({ name: 'Legacy' })
    const stored = a.store.get(bot.id)!
    stored.thread = [
      { id: 'old_q', role: 'user', text: 'book the offsite venue for tuesday', at: 1_000 },
      { id: 'old_a', role: 'assistant', text: 'booked it, tuesday', at: 2_000 },
    ]
    a.store.upsert(stored)

    assert.equal(a.importHistory(), 2)
    const turns = vault.turns(bot.id)
    assert.equal(turns.length, 2)
    assert.ok(turns.every((t) => t.user === 'Mudit'))
    assert.ok(vault.hasTurn('old_q'))

    // Idempotent — a second run imports nothing new and leaves nothing doubled.
    assert.equal(a.importHistory(), 0)
    assert.equal(vault.turns(bot.id).length, 2)
  })

  it('folds facts other bots learned into the system prompt', async () => {
    const federation = createFederationStore()
    federation.publish({ key: 'tone', value: 'always terse', sourceBotId: 'bot_other' })
    const a = createAgent({
      connectors: createConnectorStore(),
      rooms: createRoomStore(),
      settings: createSettingsStore(),
      scheduleReminder: () => ({ id: 'r', botId: '', schedule: '', prompt: '', enabled: true, origin: 'reminder' as const }),
      cancelReminders: () => 0,
      federation,
    })
    a.attach(srv.baseUrl)
    const bot = await a.createBot({ name: 'Federated' })
    await a.send(bot.id, { text: 'hello team' })

    const system = String((srv.prompts.at(-1)?.body as { system?: string } | undefined)?.system ?? '')
    assert.match(system, /Shared across the team/)
    assert.match(system, /always terse/)
  })

  it('publishes a fact the bot learns so the fleet can reuse it', async () => {
    const federation = createFederationStore()
    const a = createAgent({
      connectors: createConnectorStore(),
      rooms: createRoomStore(),
      settings: createSettingsStore(),
      scheduleReminder: () => ({ id: 'r', botId: '', schedule: '', prompt: '', enabled: true, origin: 'reminder' as const }),
      cancelReminders: () => 0,
      federation,
    })
    a.attach(srv.baseUrl)
    const bot = await a.createBot({ name: 'Learner' })

    await a.send(bot.id, { text: 'remember the codename' })
    serverEvents.emit('event', {
      type: 'message.part.delta',
      properties: { sessionID: bot.sessionId, partID: 'fed_p1', delta: 'Noted for next time: the launch codename is falcon.' },
    })
    serverEvents.emit('event', { type: 'session.idle', properties: { sessionID: bot.sessionId } })
    await waitForBot(a, (b) => b.id === bot.id && b.status === 'idle')

    assert.ok(
      federation.list().some((f) => f.value.includes('falcon') && f.sourceBotId === bot.id),
      'the learned fact should be published to the shared layer',
    )
  })

  it('tags turns recorded during a normal run with the settings user', async () => {
    const vault = createVault()
    const settings = createSettingsStore()
    settings.update({ userName: 'Priya' })
    const a = createAgent({
      connectors: createConnectorStore(),
      rooms: createRoomStore(),
      settings,
      scheduleReminder: () => ({ id: 'r', botId: '', schedule: '', prompt: '', enabled: true, origin: 'reminder' as const }),
      cancelReminders: () => 0,
      vault,
    })
    a.attach(srv.baseUrl)
    const bot = await a.createBot({ name: 'Tagged' })

    await a.send(bot.id, { text: 'hello from priya' })
    serverEvents.emit('event', {
      type: 'message.part.delta',
      properties: { sessionID: bot.sessionId, partID: 'tag_p1', delta: 'Hello Priya, noted.' },
    })
    serverEvents.emit('event', { type: 'session.idle', properties: { sessionID: bot.sessionId } })
    await waitForBot(a, (b) => b.id === bot.id && b.status === 'idle')

    const turns = vault.turns(bot.id)
    assert.equal(turns.length, 2)
    assert.ok(turns.every((t) => t.user === 'Priya'))
  })
})

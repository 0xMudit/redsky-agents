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
import { createConnectorStore } from '../electron/connectors'
import { createRoomStore } from '../electron/rooms'
import { createSettingsStore } from '../electron/settings'
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
})

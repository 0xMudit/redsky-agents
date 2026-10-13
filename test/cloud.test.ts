import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import * as fs from 'node:fs'
import { createComputerStore } from '../electron/cloud/computer'
import { createDeviceStore } from '../electron/cloud/devices'
import { createFederationStore, factVisibleTo } from '../electron/cloud/federation'
import { createHandoffStore, reciprocalInFlight } from '../electron/cloud/handoff'
import { captureRecordingSteps, createRecordingStore, draftRoutineFromRecording } from '../electron/cloud/recording'
import { createCloudRuntime, createHostedRuntime, createLocalRuntime } from '../electron/cloud/runtime'
import { cleanupTempHomes, useTempHome } from './helpers'

after(() => cleanupTempHomes())

describe('cloud runtime', () => {
  it('starts local, tracks state changes, and reports its kind', () => {
    const runtime = createLocalRuntime()
    assert.equal(runtime.kind, 'local')
    assert.equal(runtime.status().state, 'starting')
    runtime.markState('ready', 'online')
    assert.equal(runtime.status().state, 'ready')
    assert.equal(runtime.status().detail, 'online')
    assert.equal(runtime.endpoint(), null)
  })

  it('leaves the hosted runtime an explicit stub', async () => {
    const hosted = createHostedRuntime()
    assert.equal(hosted.kind, 'hosted')
    assert.equal(hosted.status().state, 'offline')
    await assert.rejects(() => hosted.start(), /not implemented/)
    assert.equal(createCloudRuntime('hosted').kind, 'hosted')
    assert.equal(createCloudRuntime('local').kind, 'local')
  })
})

describe('computer store', () => {
  it('provisions a directory per bot and powers it down without losing it', () => {
    useTempHome()
    const store = createComputerStore()
    const computer = store.ensure('bot_a')
    assert.equal(computer.state, 'ready')
    assert.ok(fs.existsSync(computer.root), 'the computer directory must exist')

    const stopped = store.stop('bot_a')
    assert.equal(stopped.state, 'stopped')
    // Coming back online is idempotent and keeps the same root.
    assert.equal(store.ensure('bot_a').root, computer.root)
  })

  it('counts saved logins without exposing their values', () => {
    useTempHome()
    const store = createComputerStore()
    const withOne = store.addCredential('bot_a', 'gmail')
    assert.equal(withOne.credentialCount, 1)
    // A repeat label is not double-counted.
    assert.equal(store.addCredential('bot_a', 'gmail').credentialCount, 1)
    assert.equal(store.addCredential('bot_a', 'github').credentialCount, 2)
  })

  it('refuses to stop a computer that was never provisioned', () => {
    useTempHome()
    const store = createComputerStore()
    assert.throws(() => store.stop('ghost'), /no computer/)
  })
})

describe('device store', () => {
  it('seeds the local desktop and registers new clients', () => {
    useTempHome()
    const store = createDeviceStore()
    assert.equal(store.list().length, 1)
    assert.equal(store.list()[0].platform, 'desktop')

    const phone = store.register({ name: 'iPhone', platform: 'ios', push: true })
    assert.equal(phone.platform, 'ios')
    assert.equal(store.list().length, 2)

    store.setPush(phone.id, false)
    assert.equal(store.list().find((d) => d.id === phone.id)?.push, false)
    store.remove(phone.id)
    assert.equal(store.list().length, 1)
  })
})

describe('recording store', () => {
  it('composes a routine prompt from a recording', () => {
    const draft = draftRoutineFromRecording(
      {
        botId: 'bot_a',
        title: 'Morning standup',
        steps: [
          { at: 1, kind: 'prompt', title: 'ask', detail: 'Summarize overnight activity.' },
          { at: 2, kind: 'tool', title: 'read inbox', detail: 'gmail search' },
        ],
      },
      'every 1 h',
    )
    assert.equal(draft.botId, 'bot_a')
    assert.equal(draft.schedule, 'every 1 h')
    assert.match(draft.prompt, /Summarize overnight activity\./)
    assert.match(draft.prompt, /What the recording did:/)
    assert.match(draft.prompt, /read inbox/)
  })

  it('captures ordered steps and stops', () => {
    useTempHome()
    const store = createRecordingStore()
    const rec = store.start({ botId: 'bot_a', title: 'Demo' })
    assert.equal(rec.state, 'recording')

    store.capture(rec.id, { kind: 'prompt', title: 'ask', detail: 'do the thing' })
    const stopped = store.stop(rec.id)
    assert.equal(stopped.state, 'stopped')
    assert.equal(stopped.steps.length, 1)
    assert.ok(stopped.stoppedAt)

    // No more steps once it has stopped.
    assert.throws(() => store.capture(rec.id, { kind: 'note', title: 'late', detail: '' }), /not active/)
  })

  it('keeps a single active recording per bot and records the routine it produced', () => {
    useTempHome()
    const store = createRecordingStore()
    const first = store.start({ botId: 'bot_a', title: 'First' })
    const second = store.start({ botId: 'bot_a', title: 'Second' })
    assert.equal(store.active('bot_a')?.id, second.id)
    assert.equal(store.get(first.id)?.state, 'stopped')

    store.markRoutine(second.id, 'job_1')
    assert.equal(store.get(second.id)?.routineId, 'job_1')
  })

  it('captures each feed event and user prompt exactly once, in time order', () => {
    const seenComputer = new Set<string>()
    const seenThread = new Set<string>()
    const feed = {
      computer: [
        { id: 'c1', kind: 'tool', title: 'run tool', detail: '', at: 3 },
        { id: 'c2', kind: 'handoff', title: 'asked Bob', detail: '', at: 4 },
      ],
      thread: [
        { id: 'm1', role: 'assistant', text: 'not a step', at: 2 },
        { id: 'm2', role: 'user', text: 'do the thing', at: 1 },
      ],
    }

    const first = captureRecordingSteps({ ...feed, seenComputer, seenThread })
    // User prompt sorts before the tool/handoff feed events; assistant ignored.
    assert.deepEqual(
      first.map((s) => [s.kind, s.title]),
      [['prompt', 'prompt'], ['tool', 'run tool'], ['note', 'asked Bob']],
    )

    // A second pass over the same snapshot yields nothing new.
    assert.equal(captureRecordingSteps({ ...feed, seenComputer, seenThread }).length, 0)
  })
})

describe('handoff store', () => {
  it('queues a handoff and walks it through its lifecycle', () => {
    useTempHome()
    const store = createHandoffStore()
    const row = store.queue({ fromBotId: 'bot_a', toBotId: 'bot_b', prompt: 'take over' })
    assert.equal(row.state, 'queued')

    assert.equal(store.transition(row.id, 'accepted').state, 'accepted')
    const done = store.transition(row.id, 'done', 'shipped')
    assert.equal(done.state, 'done')
    assert.equal(done.note, 'shipped')
    // A bot's list is its inbox and outbox.
    assert.equal(store.list('bot_a').length, 1)
    assert.equal(store.list('bot_b').length, 1)
    assert.equal(store.list('bot_z').length, 0)
  })

  it('rejects a self-handoff and an empty prompt', () => {
    useTempHome()
    const store = createHandoffStore()
    assert.throws(() => store.queue({ fromBotId: 'bot_a', toBotId: 'bot_a', prompt: 'me' }), /itself/)
    assert.throws(() => store.queue({ fromBotId: 'bot_a', toBotId: 'bot_b', prompt: '  ' }), /prompt required/)
  })

  it('flags a reciprocal handoff that is still in flight', () => {
    useTempHome()
    const store = createHandoffStore()
    const ab = store.queue({ fromBotId: 'bot_a', toBotId: 'bot_b', prompt: 'take it' })
    // A→B is queued, so B→A would loop.
    assert.equal(reciprocalInFlight(store.list(), 'bot_b', 'bot_a'), true)
    // The reverse is not a cycle yet.
    assert.equal(reciprocalInFlight(store.list(), 'bot_a', 'bot_c'), false)

    store.transition(ab.id, 'done')
    assert.equal(reciprocalInFlight(store.list(), 'bot_b', 'bot_a'), false)
  })
})

describe('federation store', () => {
  it('applies the visibility rule', () => {
    assert.equal(factVisibleTo({}, 'bot_a'), true)
    assert.equal(factVisibleTo({ sourceBotId: 'bot_a' }, 'bot_a'), true)
    assert.equal(factVisibleTo({ sourceBotId: 'bot_b', sharedWith: ['bot_a'] }, 'bot_a'), true)
    assert.equal(factVisibleTo({ sourceBotId: 'bot_b', sharedWith: ['bot_c'] }, 'bot_a'), false)
  })

  it('publishes a fact once per key and source, updating in place', () => {
    useTempHome()
    const store = createFederationStore()
    const first = store.publish({ key: 'tone', value: 'short', sourceBotId: 'bot_a' })
    const second = store.publish({ key: 'tone', value: 'concise', sourceBotId: 'bot_a' })
    assert.equal(first.id, second.id)
    assert.equal(store.list().length, 1)
    assert.equal(store.list()[0].value, 'concise')

    store.publish({ key: 'boss', value: 'Priya', sourceBotId: 'bot_b', sharedWith: ['bot_a'] })
    // bot_a sees its own tone and the shared boss fact.
    assert.equal(store.visibleTo('bot_a').length, 2)
    store.forget(first.id)
    assert.equal(store.list().length, 1)
  })

  it('requires a key and value', () => {
    useTempHome()
    const store = createFederationStore()
    assert.throws(() => store.publish({ key: '', value: 'x' }), /required/)
    assert.throws(() => store.publish({ key: 'x', value: ' ' }), /required/)
  })
})

import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createDemoApi } from '../renderer/src/demoApi'

// The demo adapter resolves its store from `window.localStorage`, so off-browser
// we hand it an in-memory Storage and hide it again afterwards.
class MemoryStorage {
  private map = new Map<string, string>()
  get length(): number {
    return this.map.size
  }
  clear(): void {
    this.map.clear()
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }
}

function useStorage(): MemoryStorage {
  const store = new MemoryStorage()
  Object.assign(globalThis, { window: { localStorage: store } })
  return store
}

// Comfortably past demoApi's 120ms save debounce, with room for slow CI runners.
const sleep = (ms = 320): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

after(() => {
  delete (globalThis as Record<string, unknown>).window
})

describe('demoApi persistence', () => {
  it('keeps created agents across instances', async () => {
    useStorage()
    const first = createDemoApi()
    const bot = await first.createBot({ name: 'Persist Me', job: 'keep this around' })
    await sleep()

    const init = await createDemoApi().init()
    const reloaded = init.bots.find((b) => b.id === bot.id)
    assert.ok(reloaded, 'expected the created agent to survive a reload')
    assert.equal(reloaded.name, 'Persist Me')
    assert.equal(reloaded.job, 'keep this around')
  })

  it('persists settings changes', async () => {
    useStorage()
    await createDemoApi().updateSettings({ privacyMode: false })
    await sleep()

    const init = await createDemoApi().init()
    assert.equal(init.settings.privacyMode, false)
  })

  it('seeds the default agent when storage is empty', async () => {
    useStorage()
    const init = await createDemoApi().init()
    assert.equal(init.bots.length, 1)
    assert.equal(init.bots[0].name, 'Chief')
  })

  it('rehydrates a bot caught mid-run back to idle', async () => {
    const store = useStorage()
    store.setItem(
      'redsky.demo.v1',
      JSON.stringify({
        version: 1,
        bots: [{ id: 'demo_x', name: 'Runner', job: '', hue: '#fff', status: 'running', thread: [], computer: [] }],
        settings: {},
        connectors: [],
        rooms: [],
        notices: [],
      }),
    )
    const init = await createDemoApi().init()
    assert.equal(init.bots[0].status, 'idle')
    assert.equal(init.bots[0].pendingPermission, undefined)
  })

  it('ignores corrupt or foreign snapshots', async () => {
    const store = useStorage()
    store.setItem('redsky.demo.v1', '{ not json')
    assert.equal((await createDemoApi().init()).bots[0].name, 'Chief')

    store.setItem('redsky.demo.v1', JSON.stringify({ version: 99, bots: [{ id: 'x' }] }))
    assert.equal((await createDemoApi().init()).bots[0].name, 'Chief')
  })

  it('writes nothing when persistence is disabled', async () => {
    const store = useStorage()
    await createDemoApi({ persist: false }).createBot({ name: 'Ephemeral' })
    await sleep(200)
    assert.equal(store.length, 0)
  })
})

describe('demoApi change detection', () => {
  it('send returns new references so React re-renders', async () => {
    useStorage()
    const api = createDemoApi()
    const bot = await api.createBot({ name: 'Refs' })
    const events: unknown[] = []
    api.onEvent((e) => events.push(e))

    const before = ((await api.listBots()).find((b) => b.id === bot.id) as typeof bot)
    const after = await api.send(bot.id, { text: 'hello there' })

    assert.notEqual(after, before, 'send must hand back a new bot object')
    assert.notEqual(after.thread, before.thread, 'the thread must be a new array reference')
    assert.equal(before.thread.length, 0, 'the previous object must not be mutated in place')
    assert.equal(after.thread.length, 1)
    assert.ok(events.length >= 1)
    assert.notEqual(events[0], before)
  })

  it('addMemory persists across reloads and takes a per-bot scope', async () => {
    useStorage()
    const api = createDemoApi()
    const bot = await api.createBot({ name: 'Scoped' })

    await api.addMemory({ key: 'tone', value: 'prefers short emails', botId: bot.id })
    await api.addMemory({ key: 'boss', value: 'Priya', botId: bot.id })
    await sleep()

    const init = await createDemoApi().init()
    assert.equal(init.memories.length, 2)

    const reloaded = createDemoApi()
    const scoped = await reloaded.listMemories(bot.id)
    assert.equal(scoped.length, 2)
    assert.equal(scoped[0].key, 'boss')
    assert.equal((await reloaded.listMemories('other_bot')).length, 0)
  })

  it('deleteMemory and clearMemories remove rows', async () => {
    useStorage()
    const api = createDemoApi()
    const added = await api.addMemory({ key: 'a', value: 'b' })
    await api.addMemory({ key: 'c', value: 'd' })

    await api.deleteMemory(added.id)
    assert.equal((await api.listMemories()).length, 1)

    await api.clearMemories()
    assert.equal((await api.listMemories()).length, 0)
  })

  it('listHistory flattens threads newest-first, tagged with the settings user', async () => {
    useStorage()
    const api = createDemoApi()
    await api.updateSettings({ userName: 'Mudit' })
    const bot = await api.createBot({ name: 'Recorder' })
    await api.send(bot.id, { text: 'first message' })

    const history = await api.listHistory()
    assert.equal(history.length, 3, 'seeded demo thread plus the new turn')
    assert.equal(history[0].botId, bot.id, 'newest turn listed first')
    const mine = history.filter((t) => t.botId === bot.id)
    assert.equal(mine.length, 1)
    assert.equal(mine[0].text, 'first message')
    assert.equal(mine[0].role, 'user')
    assert.equal(mine[0].user, 'Mudit')
    assert.equal(mine[0].botName, 'Recorder')
  })

  it('renaming and flagging swap the object in the list', async () => {
    useStorage()
    const api = createDemoApi()
    const bot = await api.createBot({ name: 'Old' })
    const renamed = await api.renameBot(bot.id, { name: 'New' })
    assert.notEqual(renamed, bot)
    const listed = (await api.listBots()).find((b) => b.id === bot.id)
    assert.equal(listed, renamed, 'the list must hold the new object')
    assert.equal(listed?.name, 'New')
  })

  it('reorderBots assigns a sequential order and persists it', async () => {
    useStorage()
    const api = createDemoApi()
    const a = await api.createBot({ name: 'A' })
    const b = await api.createBot({ name: 'B' })
    const c = await api.createBot({ name: 'C' })

    const updated = await api.reorderBots([c.id, a.id, b.id])
    assert.equal(updated.find((x) => x.id === c.id)?.order, 0)
    assert.equal(updated.find((x) => x.id === a.id)?.order, 1)
    assert.equal(updated.find((x) => x.id === b.id)?.order, 2)

    await sleep()
    const reloaded = await createDemoApi().init()
    assert.equal(reloaded.bots.find((x) => x.id === c.id)?.order, 0)
  })
})

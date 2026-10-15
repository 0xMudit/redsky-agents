import * as path from 'node:path'
import { JsonStore } from '../lib/persist'
import { newId } from '../lib/ids'
import { userDataDir } from '../paths'
import type { DeviceClient, DevicePlatform } from '../../shared/cloud'

/**
 * Feature 3 — the clients that can attach to a runtime.
 *
 * A device is any surface the user drives their bots from: this Electron app, a
 * browser tab, and — the reason the type exists — a phone. The registry records
 * only identity and liveness; authentication and transport are the hosted
 * runtime's job. `register` is the seam the iOS client will call once it exists.
 *
 * The desktop app seeds itself so the list is never empty in the UI.
 */
export interface DeviceStore {
  list: () => DeviceClient[]
  register: (payload: { name: string; platform: DevicePlatform; push?: boolean }) => DeviceClient
  touch: (id: string) => DeviceClient
  setPush: (id: string, push: boolean) => DeviceClient
  remove: (id: string) => void
  /** Flush any pending debounced write immediately. Call on app.before-quit. */
  flush: () => void
}

const PLATFORMS: DevicePlatform[] = ['desktop', 'web', 'ios', 'android']

export function createDeviceStore(): DeviceStore {
  const db = new JsonStore<DeviceClient[]>(path.join(userDataDir(), 'devices.json'), [])

  function seed(): DeviceClient[] {
    const now = Date.now()
    return [{ id: 'device_desktop_local', name: 'This desktop', platform: 'desktop', lastSeen: now, push: true }]
  }

  let rows = db.read()
  if (!rows.length) {
    rows = seed()
    db.write(rows)
  }
  const persist = () => db.write(rows)

  return {
    list: () => rows.map((d) => ({ ...d })),
    register(payload) {
      const platform = PLATFORMS.includes(payload.platform) ? payload.platform : 'web'
      const row: DeviceClient = {
        id: newId('device'),
        name: payload.name.trim().slice(0, 60) || 'Unnamed device',
        platform,
        lastSeen: Date.now(),
        push: payload.push !== false,
      }
      rows.push(row)
      persist()
      return { ...row }
    },
    touch(id) {
      const row = rows.find((d) => d.id === id)
      if (!row) throw new Error(`unknown device: ${id}`)
      row.lastSeen = Date.now()
      persist()
      return { ...row }
    },
    setPush(id, push) {
      const row = rows.find((d) => d.id === id)
      if (!row) throw new Error(`unknown device: ${id}`)
      row.push = push
      persist()
      return { ...row }
    },
    remove(id) {
      rows = rows.filter((d) => d.id !== id)
      persist()
    },
    flush: () => db.flush(),
  }
}

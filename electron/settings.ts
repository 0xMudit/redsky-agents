import * as path from 'node:path'
import { JsonStore } from './lib/persist'
import { userDataDir } from './paths'
import type { AppSettings } from '../shared/types'

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  privacyMode: true,
  autoReview: 'sensitive',
  allowBotHandoff: true,
  maxParallelBots: 8,
}

export interface SettingsStore {
  get: () => AppSettings
  update: (patch: Partial<AppSettings>) => AppSettings
}

export function createSettingsStore(): SettingsStore {
  const db = new JsonStore<AppSettings>(path.join(userDataDir(), 'settings.json'), DEFAULT_SETTINGS)

  function normalize(raw: AppSettings): AppSettings {
    return {
      version: 1,
      privacyMode: raw.privacyMode !== false,
      autoReview: raw.autoReview === 'always' || raw.autoReview === 'off' ? raw.autoReview : 'sensitive',
      allowBotHandoff: raw.allowBotHandoff !== false,
      maxParallelBots: Math.min(32, Math.max(1, Number.isFinite(Number(raw.maxParallelBots)) ? Number(raw.maxParallelBots) : 8)),
defaultModel: raw.defaultModel,
  speakResults: raw.speakResults === true,
  lastDigestAt: typeof raw.lastDigestAt === 'number' ? raw.lastDigestAt : undefined,
  userName: typeof raw.userName === 'string' ? raw.userName.trim().slice(0, 60) || undefined : undefined,
  }
}

  return {
    get: () => normalize(db.read()),
    update(patch) {
      const next = normalize({ ...db.read(), ...patch, version: 1 })
      db.write(next)
      return next
    },
  }
}

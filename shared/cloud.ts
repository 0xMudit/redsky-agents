/**
 * Domain types for the cloud/hosted capabilities (see docs/FEATURES-CLOUD.md).
 *
 * These describe the shape the renderer and the main process agree on. The
 * implementations live under `electron/cloud/`; today only the local runtime is
 * wired up, with the hosted runtime left as an explicit stub. Keep the persisted
 * variants (`CloudComputer`, `Handoff`, `FederatedFact`, `Recording`, `DeviceClient`)
 * JSON-safe so they can ride the existing `JsonStore` pattern.
 */

/** Where a capability is running: on this machine, or on a Red Sky host (future). */
export type CloudRuntimeKind = 'local' | 'hosted'

export type CloudRuntimeState = 'offline' | 'starting' | 'ready' | 'degraded'

export interface CloudRuntimeStatus {
  kind: CloudRuntimeKind
  state: CloudRuntimeState
  /** Human-readable note, e.g. why the runtime is degraded or offline. */
  detail?: string
  /** When the runtime last changed state. */
  since: number
}

/* Feature 1 — a persistent computer every bot owns. */

export type ComputerState = 'provisioning' | 'ready' | 'stopped' | 'error'

export interface CloudComputer {
  botId: string
  state: ComputerState
  /** Absolute directory the bot's file and shell tools are confined to. */
  root: string
  /**
   * How many saved logins the computer holds. Credential values are never sent
   * to the renderer — only this count crosses the bridge.
   */
  credentialCount: number
  createdAt: number
  updatedAt: number
}

/* Feature 2 — always-on presence. */

export interface PresenceEvent {
  at: number
  state: CloudRuntimeState
}

export interface Presence {
  botId: string
  online: boolean
  /** When true, the runtime restarts the bot's computer after a crash or reboot. */
  keepAlive: boolean
  lastBeat?: PresenceEvent
}

/* Feature 3 — attached clients. */

export type DevicePlatform = 'desktop' | 'web' | 'ios' | 'android'

export interface DeviceClient {
  id: string
  name: string
  platform: DevicePlatform
  /** Last time the client pinged the runtime. */
  lastSeen: number
  /** Whether this device receives push notifications from the runtime. */
  push: boolean
}

/* Feature 5 — teach-by-showing recording. */

export type RecordingState = 'idle' | 'recording' | 'stopped'

export interface RecordingStep {
  at: number
  kind: 'prompt' | 'tool' | 'shell' | 'file' | 'note'
  title: string
  detail: string
}

export interface Recording {
  id: string
  botId: string
  state: RecordingState
  title: string
  steps: RecordingStep[]
  startedAt: number
  stoppedAt?: number
  /** Set once the recording has been turned into a routine. */
  routineId?: string
}

/* Feature 7 — cross-bot shared knowledge. */

export interface FederatedFact {
  id: string
  key: string
  value: string
  /** Bot that first learned it; absent means the user taught it directly. */
  sourceBotId?: string
  /** Bots allowed to read it. Empty means every bot. */
  sharedWith?: string[]
  createdAt: number
  updatedAt: number
}

/* Feature 8 — bot-to-bot handoff bus. */

export type HandoffState = 'queued' | 'accepted' | 'done' | 'failed'

export interface Handoff {
  id: string
  fromBotId: string
  toBotId: string
  prompt: string
  state: HandoffState
  note?: string
  createdAt: number
  updatedAt: number
}

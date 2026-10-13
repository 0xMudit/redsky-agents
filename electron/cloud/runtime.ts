import type { CloudRuntimeKind, CloudRuntimeState, CloudRuntimeStatus } from '../../shared/cloud'

/**
 * Feature 2 — the 24/7 runtime abstraction.
 *
 * `CloudRuntime` is the seam between Red Sky and wherever bots actually run.
 * The local implementation runs in this process (the OpenCode server plus the
 * scheduler that already exists); the hosted implementation is a stub a future
 * backend will fill in. Nothing above this interface should care which one is
 * active — it asks for a status and an endpoint, and that is all.
 */
export interface CloudRuntime {
  readonly kind: CloudRuntimeKind
  status: () => CloudRuntimeStatus
  start: () => Promise<void>
  stop: () => Promise<void>
  /** Absolute base URL clients connect to; null until the runtime is ready. */
  endpoint: () => string | null
}

/**
 * The local runtime additionally exposes `markState`, because `main.ts` owns the
 * boot sequence (it is what learns whether OpenCode answered) and needs to
 * reflect that back into the runtime's status.
 */
export interface LocalRuntime extends CloudRuntime {
  markState: (state: CloudRuntimeState, detail?: string) => void
}

/**
 * Local runtime — the current behaviour, wrapped so the rest of the app can
 * treat it as one of several runtimes. It is "ready" as soon as the OpenCode
 * server answers; `markState` lets `main.ts` reflect boot failures.
 */
export function createLocalRuntime(): LocalRuntime {
  let state: CloudRuntimeState = 'starting'
  let detail: string | undefined
  let since = Date.now()

  const set = (next: CloudRuntimeState, note?: string): void => {
    state = next
    detail = note
    since = Date.now()
  }

  return {
    kind: 'local',
    status: () => ({ kind: 'local', state, detail, since }),
    async start() {
      set('starting', 'starting OpenCode…')
    },
    async stop() {
      set('offline', 'stopped')
    },
    endpoint: () => null,
    markState: set,
  }
}

/**
 * Hosted runtime — placeholder for a Red Sky backend that keeps bots running
 * when the desktop app is closed. Every method is intentionally unimplemented:
 * the shape is here so the renderer, IPC, and stores can be built against it
 * before the service exists. See docs/FEATURES-CLOUD.md.
 */
export function createHostedRuntime(): CloudRuntime {
  return {
    kind: 'hosted',
    status: () => ({ kind: 'hosted', state: 'offline', detail: 'hosted runtime not implemented', since: Date.now() }),
    async start() {
      throw new Error('hosted runtime is not implemented yet')
    },
    async stop() {
      /* nothing to tear down */
    },
    endpoint: () => null,
  }
}

/** Resolve a runtime from its kind. Defaults to the local runtime. */
export function createCloudRuntime(kind: CloudRuntimeKind = 'local'): CloudRuntime {
  return kind === 'hosted' ? createHostedRuntime() : createLocalRuntime()
}

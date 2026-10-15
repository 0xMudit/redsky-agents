/**
 * OS-level permission checks for Red Sky.
 *
 * Called once during app startup (after the window is shown) and again via the
 * `rs:checkPermissions` IPC call so the Settings panel can show live status.
 *
 * Platform behaviour:
 *   macOS  — Electron exposes `systemPreferences.getMediaAccessStatus` and
 *             `systemPreferences.askForMediaAccess`. Notification permission is
 *             handled via the standard `Notification.isSupported()` / OS prompt.
 *   Windows — Media access is controlled by the OS Privacy settings; Electron's
 *             `systemPreferences.getMediaAccessStatus` works on Windows 10 1809+
 *             for microphone/camera. Notifications are always available.
 *   Linux  — No Electron API for runtime permission requests; we report
 *             'unsupported' so callers can skip the check gracefully.
 */

import { app, Notification, systemPreferences } from 'electron'
import { createLogger } from './lib/logger'

const log = createLogger()

export type PermissionStatus = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unsupported'

export interface AppPermissions {
  notifications: PermissionStatus
  microphone: PermissionStatus
}

/**
 * Query current permission status without prompting the user.
 * Safe to call from any context.
 */
export function queryPermissions(): AppPermissions {
  return {
    notifications: queryNotifications(),
    microphone: queryMicrophone(),
  }
}

/**
 * Request any permissions that are still 'not-determined'.
 * Must be called after `app.whenReady()` resolves (requires a visible window on macOS).
 * Returns the resolved status for each permission.
 */
export async function requestPermissions(): Promise<AppPermissions> {
  const current = queryPermissions()

  const mic =
    current.microphone === 'not-determined'
      ? await requestMicrophone()
      : current.microphone

  // Notifications: on macOS the OS shows its own prompt the first time
  // `new Notification(...).show()` is called — no explicit request API needed.
  // On Windows/Linux `Notification.isSupported()` is always true.

  const perms: AppPermissions = {
    notifications: queryNotifications(),
    microphone: mic,
  }

  log.info('permissions.resolved', perms as unknown as Record<string, unknown>)
  return perms
}

// ── Notifications ─────────────────────────────────────────────────────────────

function queryNotifications(): PermissionStatus {
  if (!Notification.isSupported()) return 'unsupported'
  if (process.platform === 'darwin') {
    // macOS exposes a typed status we can read before the prompt appears.
    try {
      const status = systemPreferences.getMediaAccessStatus('notifications' as Parameters<typeof systemPreferences.getMediaAccessStatus>[0])
      // 'notifications' is only a valid key on macOS 10.14+; older versions throw.
      return mapStatus(status)
    } catch {
      // Older macOS or unsupported key — treat as not-determined so the OS
      // prompt fires naturally on first notification.
      return 'not-determined'
    }
  }
  // Windows / Linux: supported, assumed granted (managed by OS Privacy settings).
  return 'granted'
}

// ── Microphone ────────────────────────────────────────────────────────────────

function queryMicrophone(): PermissionStatus {
  if (process.platform === 'linux') return 'unsupported'
  try {
    const status = systemPreferences.getMediaAccessStatus('microphone')
    return mapStatus(status)
  } catch {
    return 'unsupported'
  }
}

async function requestMicrophone(): Promise<PermissionStatus> {
  if (process.platform === 'linux') return 'unsupported'
  try {
    const granted = await systemPreferences.askForMediaAccess('microphone')
    return granted ? 'granted' : 'denied'
  } catch {
    return 'unsupported'
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapStatus(raw: string): PermissionStatus {
  switch (raw) {
    case 'granted':       return 'granted'
    case 'denied':        return 'denied'
    case 'restricted':    return 'restricted'
    case 'not-determined':
    case 'unknown':       return 'not-determined'
    default:              return 'unsupported'
  }
}

/**
 * Run the startup permission check.
 *
 * Designed to be called from `deferredInit()` — after the window is visible —
 * so the OS prompt (if any) appears in context rather than before the app UI is ready.
 * Best-effort: errors are logged and never propagate to the caller.
 */
export async function runStartupPermissionCheck(): Promise<void> {
  if (!app.isReady()) return
  try {
    await requestPermissions()
  } catch (err) {
    log.warn('permissions.check.failed', { err: (err as Error).message })
  }
}

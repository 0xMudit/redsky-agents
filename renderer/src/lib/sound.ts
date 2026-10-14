const SOUND_SRC = 'mixkit-software-interface-back-2575.wav'

let audio: HTMLAudioElement | null = null

function ensure(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof window.Audio === 'undefined') return null
  if (!audio) {
    audio = new Audio(SOUND_SRC)
    audio.preload = 'auto'
    audio.volume = 0.5
  }
  return audio
}

/** Warm the audio element so the first reminder chime plays without delay. */
export function preloadReminderSound(): void {
  const el = ensure()
  try {
    el?.load()
  } catch {
    /* nothing to do */
  }
}

/**
 * Play the reminder chime. Safe to call anytime — autoplay restrictions or a
 * missing file simply result in silence.
 */
export function playReminderSound(): void {
  const el = ensure()
  if (!el) return
  try {
    el.currentTime = 0
    void el.play().catch(() => undefined)
  } catch {
    /* ignore */
  }
}

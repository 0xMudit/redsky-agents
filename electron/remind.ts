import { nextDelayMs } from './scheduler'

export interface ParsedReminder {
  schedule: string
  task: string
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function parseCancelReminder(text: string): boolean {
  const s = normalize(text).toLowerCase()
  return (
    /\bstop remind/i.test(s) ||
    /\bstop reminding\b/.test(s) ||
    /\bcancel (the )?reminders?\b/.test(s) ||
    /\bno more reminders?\b/.test(s) ||
    /\bdon'?t remind\b/.test(s)
  )
}

export function parseReminder(text: string): ParsedReminder | null {
  const raw = normalize(text)
  const s = raw.toLowerCase()
  if (!/\bremind|\breminder/.test(s)) return null
  if (parseCancelReminder(raw) && !/\b(every|each)\b/.test(s) && !/\bat\s+\d/.test(s)) return null

  let schedule: string | null = null
  const every = s.match(/\b(?:every|each)\s+(?:(\d+)\s*)?(min(?:ute)?s?|m|hours?|hrs?|h)\b/)
  if (every) {
    const n = every[1] ? Number(every[1]) : 1
    if (!Number.isFinite(n) || n <= 0) return null
    schedule = every[2].startsWith('h') ? `every ${n} h` : `every ${n} m`
  } else {
    const clock = s.match(/\bat\s+(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm))?\b/)
    if (clock) {
      let h = Number(clock[1])
      const m = clock[2] ? Number(clock[2]) : 0
      const ap = clock[3]
      if (ap === 'pm' && h < 12) h += 12
      if (ap === 'am' && h === 12) h = 0
      schedule = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }
  }
  if (!schedule || nextDelayMs(schedule) == null) return null

  let task = raw
    .replace(/^(please\s+)?keep\s+/i, '')
    .replace(/^(please\s+)?remind(er|ing)?\s+(me\b)?\s*[:=>~\-–—]*\s*(to\b)?/i, '')
    .replace(/\b(every|each)\s+(\d+\s*)?(min(?:ute)?s?|m|hours?|hrs?|h)\b/gi, '')
    .replace(/\bat\s+\d{1,2}(?::\d{2})?(?:\s*(am|pm))?\b/gi, '')
    .replace(/\bso i wanna.*$/i, '')
    .replace(/[.,!]+$/g, '')
    .trim()
    .replace(/^[\s=:>~\-–—]+/, '')
    .replace(/\s+(?:in|at|on|by|for|to|each|every)\s*$/i, '')
    .replace(/^[\s=:>~\-–—]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!task || task.length < 2) task = 'this'
  return { schedule, task }
}

export function reminderLabel(schedule: string): string {
  const every = schedule.match(/^every\s+(\d+)\s*(m|h)$/)
  if (every) {
    const n = every[1]
    const unit = every[2] === 'h' ? (n === '1' ? 'hour' : 'hours') : n === '1' ? 'minute' : 'minutes'
    return n === '1' && every[2] === 'm' ? 'every minute' : `every ${n} ${unit}`
  }
  return `daily at ${schedule}`
}

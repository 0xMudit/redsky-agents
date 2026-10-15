import * as path from 'node:path'
import { JsonStore } from '../lib/persist'
import { newId } from '../lib/ids'
import { userDataDir } from '../paths'
import type { Recording, RecordingStep } from '../../shared/cloud'

/**
 * Feature 5 — teach by showing.
 *
 * A recording watches what a bot does (the same events the activity feed
 * already receives) and keeps an ordered list of steps. Stopping it, then
 * pairing it with a schedule, turns the demonstration into a `Routine` — the
 * "show me once, run it forever" flow. The pure helper below is the part worth
 * testing; the store is the usual JsonStore wrapper.
 */

/** A step as the caller supplies it; the store stamps the timestamp. */
export type RecordingStepInput = Omit<RecordingStep, 'at'>

/** A computer-feed event the capture pass reads (structurally a ComputerEvent). */
export interface CaptureFeedEvent {
  id?: string
  kind: string
  title: string
  detail: string
  at?: number
}

/** A thread message the capture pass reads (structurally a ChatMessage). */
export interface CaptureFeedMessage {
  id?: string
  role: string
  text: string
  at?: number
}

/** How a computer-feed kind lands in a recording. Handoffs and reviews are notes. */
const STEP_KIND: Record<string, RecordingStep['kind']> = {
  tool: 'tool',
  shell: 'shell',
  file: 'file',
  note: 'note',
  handoff: 'note',
  review: 'note',
}

/**
 * Diff a bot snapshot against what a recording has already seen, returning the
 * new steps and seeding the caller's sets with the ids consumed. Pure apart
 * from mutating the two sets it is handed, so the live capture pass in main.ts
 * stays a thin loop and this logic can be tested on its own. Only user prompts
 * count as steps from the thread — assistant text is not a demonstration.
 */
export function captureRecordingSteps(input: {
  computer: ReadonlyArray<CaptureFeedEvent>
  thread: ReadonlyArray<CaptureFeedMessage>
  seenComputer: Set<string>
  seenThread: Set<string>
}): RecordingStepInput[] {
  const pending: Array<{ at: number; step: RecordingStepInput }> = []
  for (const ev of input.computer) {
    if (!ev.id || input.seenComputer.has(ev.id)) continue
    input.seenComputer.add(ev.id)
    pending.push({
      at: ev.at ?? 0,
      step: { kind: STEP_KIND[ev.kind] ?? 'note', title: ev.title, detail: ev.detail },
    })
  }
  for (const msg of input.thread) {
    if (msg.role !== 'user' || !msg.id || input.seenThread.has(msg.id)) continue
    input.seenThread.add(msg.id)
    pending.push({ at: msg.at ?? 0, step: { kind: 'prompt', title: 'prompt', detail: msg.text } })
  }
  return pending.sort((a, b) => a.at - b.at).map((p) => p.step)
}

export interface RecordingStore {
  list: (botId?: string) => Recording[]
  get: (id: string) => Recording | undefined
  /** The in-progress recording for a bot, if any. */
  active: (botId: string) => Recording | undefined
  start: (payload: { botId: string; title?: string }) => Recording
  capture: (id: string, step: RecordingStepInput) => Recording
  stop: (id: string) => Recording
  /** Record which routine a finished recording produced. */
  markRoutine: (id: string, routineId: string) => Recording
  /** Flush any pending debounced write immediately. Call on app.before-quit. */
  flush: () => void
}

/**
 * Turn a finished recording into the prompt a routine should run. Steps that
 * were prompts the user typed are the spine; everything else becomes a
 * bracketed note so the replaying bot sees what happened, not just what was
 * asked. Not a security boundary — the scheduler still validates the schedule.
 */
export function draftRoutineFromRecording(
  recording: Pick<Recording, 'title' | 'steps' | 'botId'>,
  schedule: string,
): { botId: string; schedule: string; prompt: string } {
  const prompts = recording.steps.filter((s) => s.kind === 'prompt').map((s) => s.detail.trim())
  const notes = recording.steps
    .filter((s) => s.kind !== 'prompt')
    .map((s) => `- ${s.title}${s.detail ? `: ${s.detail}` : ''}`)
  const body = prompts.length ? prompts.join('\n') : recording.title.trim() || 'Run the recorded task.'
  const prompt = notes.length ? `${body}\n\nWhat the recording did:\n${notes.join('\n')}` : body
  return { botId: recording.botId, schedule: schedule.trim(), prompt }
}

export function createRecordingStore(): RecordingStore {
  const db = new JsonStore<Recording[]>(path.join(userDataDir(), 'recordings.json'), [])
  let rows = db.read()
  const persist = () => db.write(rows)

  const clone = (rec: Recording): Recording => ({ ...rec, steps: rec.steps.map((s) => ({ ...s })) })
  const find = (id: string): Recording | undefined => rows.find((r) => r.id === id)

  return {
    list: (botId) => rows.filter((r) => !botId || r.botId === botId).map(clone),
    get: (id) => {
      const row = find(id)
      return row ? clone(row) : undefined
    },
    active: (botId) => {
      const row = rows.find((r) => r.botId === botId && r.state === 'recording')
      return row ? clone(row) : undefined
    },
    start({ botId, title }) {
      if (!botId.trim()) throw new Error('bot id required')
      // Only one recording per bot: close any open one instead of orphaning it.
      for (const row of rows) {
        if (row.botId === botId && row.state === 'recording') {
          row.state = 'stopped'
          row.stoppedAt = Date.now()
        }
      }
      const now = Date.now()
      const rec: Recording = {
        id: newId('rec'),
        botId,
        state: 'recording',
        title: (title ?? '').trim() || 'Untitled recording',
        steps: [],
        startedAt: now,
      }
      rows.push(rec)
      persist()
      return clone(rec)
    },
    capture(id, step) {
      const row = find(id)
      if (!row) throw new Error(`unknown recording: ${id}`)
      if (row.state !== 'recording') throw new Error('recording is not active')
      row.steps.push({ at: Date.now(), ...step })
      persist()
      return clone(row)
    },
    stop(id) {
      const row = find(id)
      if (!row) throw new Error(`unknown recording: ${id}`)
      if (row.state === 'recording') {
        row.state = 'stopped'
        row.stoppedAt = Date.now()
        persist()
      }
      return clone(row)
    },
    markRoutine(id, routineId) {
      const row = find(id)
      if (!row) throw new Error(`unknown recording: ${id}`)
      row.routineId = routineId
      persist()
      return clone(row)
    },
    flush: () => db.flush(),
  }
}

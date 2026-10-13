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
  }
}

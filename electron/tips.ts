import { api, apiEmpty } from './http'

/**
 * Life tips for the small "working" window.
 *
 * The tips are written by the model (the user's choice) through the local
 * OpenCode server, in a throwaway session kept out of the agent list. One
 * request returns a batch, which is cached in memory so that showing the next
 * tip never blocks on a model round-trip.
 */

const TIP_SYSTEM =
  'You are a concise life coach. Reply with only short, specific, practical tips for getting better at life. ' +
  'No preamble, no numbering, no quotation marks, no emoji.'

const TIP_PROMPT =
  'Write 12 distinct, original tips for getting better at life, one per line. ' +
  'Cover different areas — health, focus, money, relationships, learning, mindset. ' +
  'Each tip is a single short sentence of at most 16 words.'

/** Neutral tips so the window is never empty if the model cannot be reached. */
export const FALLBACK_TIPS: string[] = [
  'Small steps repeated daily beat big plans you never start.',
  'Protect one hour of deep focus before the world wakes up.',
  'Name the next physical action — vagueness is what stalls you.',
  'Spend on things that save you time, not things that fill it.',
  'Ask one more question than feels comfortable in every conversation.',
  'Sleep is the cheapest performance upgrade you will ever get.',
  'Do the hardest thing first, while your willpower is still full.',
  'Trade a little comfort today for a lot of freedom later.',
]

/** Strip list markers/quotes and keep only lines that look like a tip. */
export function splitTips(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n+/)) {
    // Strip list markers repeatedly so "• 2) tip" becomes "tip".
    let clean = line.trim()
    for (;;) {
      const next = clean.replace(/^(?:[-*•]|\d+[.)])\s*/, '')
      if (next === clean) break
      clean = next
    }
    clean = clean.replace(/^["'`“”]+|["'`“”]+$/g, '').replace(/\s+/g, ' ').trim()
    if (clean.length >= 12 && clean.length <= 220) out.push(clean)
  }
  return out.slice(0, 24)
}

/** Pull assistant text out of an OpenCode `GET /session/:id/message` payload. */
export function assistantText(raw: unknown): string {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { messages?: unknown[] }).messages)
      ? (raw as { messages: unknown[] }).messages
      : []
  const texts: string[] = []
  for (const item of list) {
    const rec = item as { info?: Record<string, unknown>; parts?: unknown[]; role?: string }
    const info: Record<string, unknown> = rec.info ?? (item as Record<string, unknown>)
    if (String(info.role ?? rec.role ?? '') !== 'assistant') continue
    const parts = Array.isArray(rec.parts)
      ? rec.parts
      : Array.isArray(info.parts)
        ? (info.parts as unknown[])
        : []
    for (const p of parts) {
      const part = p as Record<string, unknown>
      if (part.type === 'text' && typeof part.text === 'string') texts.push(part.text)
    }
  }
  return texts.join('\n')
}

export interface TipEngineOptions {
  /** Resolved lazily so the engine can be built before the server is up. */
  baseUrl: () => string
  /** How long to wait for a single generation before giving up. */
  timeoutMs?: number
  /** Poll interval while waiting for a generation (tests can shorten it). */
  pollMs?: number
}

export interface TipEngine {
  /** The next tip to show. Never rejects — falls back to a bundled tip. */
  next: () => Promise<string>
  /** Generate a batch in the background so the first send already has tips. */
  warm: () => void
  /** How many generated tips are cached (tests / diagnostics). */
  size: () => number
}

export function createTipEngine(opts: TipEngineOptions): TipEngine {
  const timeoutMs = opts.timeoutMs ?? 20_000
  const pollMs = opts.pollMs ?? 500
  const pool: string[] = []
  let sessionId = ''
  let inflight: Promise<void> | null = null

  async function ensureSession(base: string): Promise<string> {
    if (sessionId) return sessionId
    const created = await api<Record<string, unknown>>('POST', `${base}/session`, { title: 'Red Sky · life tips' })
    const id = String(created.id ?? created.sessionID ?? (created as { session?: { id?: string } }).session?.id ?? '')
    if (!id) throw new Error('OpenCode did not return a session id')
    sessionId = id
    return id
  }

  async function generate(): Promise<void> {
    const base = opts.baseUrl()
    if (!base) return
    const sid = await ensureSession(base)
    await apiEmpty('POST', `${base}/session/${sid}/prompt_async`, {
      system: TIP_SYSTEM,
      parts: [{ type: 'text', text: TIP_PROMPT }],
    })
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs))
      // A server restart invalidates the session id and the base URL.
      if (opts.baseUrl() !== base) {
        sessionId = ''
        return
      }
      try {
        const msgs = await api<unknown>('GET', `${base}/session/${sid}/message`)
        const tips = splitTips(assistantText(msgs))
        if (tips.length) {
          for (const tip of tips) if (!pool.includes(tip)) pool.push(tip)
          return
        }
      } catch {
        /* keep polling until the deadline */
      }
    }
  }

  function replenish(min = 3): void {
    if (inflight || pool.length >= min) return
    inflight = generate()
      .catch(() => undefined)
      .finally(() => {
        inflight = null
      })
  }

  return {
    async next() {
      if (!pool.length) {
        // Wait for an in-flight batch (bounded), then top up for next time.
        if (!inflight) replenish(1)
        if (inflight) await Promise.race([inflight, new Promise((r) => setTimeout(r, 6500))])
      }
      replenish()
      return pool.shift() ?? FALLBACK_TIPS[Math.floor(Math.random() * FALLBACK_TIPS.length)]
    },
    warm: () => replenish(10),
    size: () => pool.length,
  }
}

import { NextResponse } from 'next/server'

// Server-side only. GROQ_API_KEY is read from the environment and never sent to
// the browser; this route is the single place the key is used.
export const runtime = 'nodejs'
export const maxDuration = 60

const DEFAULT_MODEL = 'openai/gpt-oss-120b'
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

interface ChatBody {
  messages?: { role?: string; content?: string }[]
  name?: string
  job?: string
  model?: string
  /** Durable facts about the user, rendered as `key: value`. */
  memory?: string[]
  userName?: string
}

export async function POST(req: Request) {
  const key = process.env.GROQ_API_KEY
  if (!key) {
    return NextResponse.json({ error: 'GROQ_API_KEY is not configured on the server.' }, { status: 500 })
  }

  let body: ChatBody
  try {
    body = (await req.json()) as ChatBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const name = (body.name || 'Red Sky agent').slice(0, 60)
  const job = (body.job || '').slice(0, 400)
  const userName = typeof body.userName === 'string' ? body.userName.trim().slice(0, 60) : ''
  const memory = Array.isArray(body.memory)
    ? body.memory.map((m) => (typeof m === 'string' ? m.trim().slice(0, 240) : '')).filter(Boolean).slice(0, 12)
    : []
  const system =
    `You are ${name}, an autonomous teammate running inside Red Sky.` +
    (job ? ` Your job: ${job}` : '') +
    (userName ? ` The person talking to you is ${userName}.` : '') +
    ' Be concise, practical, and action-oriented. Prefer short, concrete answers over preamble.' +
    (memory.length
      ? `\n\nThings you remember about this user:\n${memory.map((m) => `- ${m}`).join('\n')}`
      : '') +
    (memory.length
      ? '\nUse these memories to personalize replies. If the user refers to anything from the past, rely on them instead of asking the user to repeat it.'
      : '')

  const history = Array.isArray(body.messages) ? body.messages : []
  const messages = [
    { role: 'system', content: system },
    ...history
      .filter(
        (m) =>
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string' &&
          m.content.trim().length > 0,
      )
      .slice(-20)
      .map((m) => ({ role: m.role as string, content: (m.content as string).slice(0, 8000) })),
  ]

  const model =
    typeof body.model === 'string' && body.model ? body.model : process.env.GROQ_MODEL || DEFAULT_MODEL

  const payload: Record<string, unknown> = { model, messages, temperature: 0.6, max_tokens: 1024 }
  // gpt-oss models are reasoning models; low effort keeps replies fast and stops
  // hidden reasoning from eating the whole token budget.
  if (model.includes('gpt-oss')) payload.reasoning_effort = 'low'

  try {
    const upstream = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
    })

    const data = (await upstream.json().catch(() => null)) as
      | { choices?: { message?: { content?: string } }[]; error?: { message?: string } | string }
      | null

    if (!upstream.ok) {
      const err = data?.error
      const detail = typeof err === 'string' ? err : err?.message || `Groq error ${upstream.status}`
      return NextResponse.json({ error: detail }, { status: upstream.status })
    }

    const text = data?.choices?.[0]?.message?.content?.trim() || '(no response)'
    return NextResponse.json({ text })
  } catch (err) {
    return NextResponse.json({ error: `Upstream request failed: ${(err as Error).message}` }, { status: 502 })
  }
}

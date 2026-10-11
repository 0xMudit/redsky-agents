import { createDemoApi } from '@renderer/demoApi'
import { stripThinking } from '@shared/visible'
import type { InitPayload, ModelOption, RedSkyApi } from '@renderer/types'

// Groq's OpenAI-compatible endpoint model ids. The first is the default; the
// route handler also accepts GROQ_MODEL to override.
const GROQ_MODELS: ModelOption[] = [
  { id: 'openai/gpt-oss-120b', label: 'Groq · GPT-OSS 120B', isDefault: true },
  { id: 'openai/gpt-oss-20b', label: 'Groq · GPT-OSS 20B', isDefault: false },
  { id: 'qwen/qwen3.8-27b', label: 'Groq · Qwen3.8 27B', isDefault: false },
]

interface ChatReply {
  text?: string
  error?: string
}

/**
 * The web build's bridge. It reuses the desktop demo adapter for every local,
 * stateless concern (agents, memory, rooms, settings, …) but swaps the reply
 * source: `send` now talks to `/api/chat`, which calls Groq from the server so
 * the API key never reaches the browser.
 */
export function createWebApi(): RedSkyApi {
  const base = createDemoApi({
    respond: async ({ bot, model }) => {
      const messages = bot.thread
        .filter((m) => m.role !== 'system' && m.text?.trim())
        .map((m) => ({
          role: m.role,
          // Never replay chain-of-thought back to the model.
          content: m.role === 'assistant' ? stripThinking(m.text) : m.text,
        }))

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages, name: bot.name, job: bot.job, model }),
      })
      const data = (await res.json().catch(() => ({}))) as ChatReply
      if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status})`)
      return data.text ?? ''
    },
  })

  return {
    ...base,
    init: async (): Promise<InitPayload> => ({ ...(await base.init()), models: GROQ_MODELS }),
    models: async () => GROQ_MODELS,
  }
}

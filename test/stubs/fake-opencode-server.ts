/**
 * Minimal fake OpenCode HTTP server for agent loop tests.
 *
 * Implements just the endpoints createAgent() and its helpers call:
 *   POST /session                  → { id }
 *   GET  /session/:id              → { id, title }
 *   GET  /session/:id/message      → []
 *   POST /session/:id/prompt_async → 204
 *   POST /session/:id/abort        → true
 *   POST /session/:id/permissions/:pid → 204
 *   DELETE /session/:id            → 204
 *   GET  /event                    SSE stream (push events via pushEvent())
 *
 * Usage:
 *   const srv = await startFakeServer()
 *   // ... tests ...
 *   srv.stop()
 */

import * as http from 'node:http'
import { EventEmitter } from 'node:events'

export interface FakeServer {
  baseUrl: string
  /** Push a raw SSE event object to every connected /event client. */
  pushEvent: (evt: Record<string, unknown>) => void
  /** Recorded prompt_async calls: [{ sessionId, body }] */
  prompts: Array<{ sessionId: string; body: Record<string, unknown> }>
  /** Recorded permission responses: [{ sessionId, permId, body }] */
  permissions: Array<{ sessionId: string; permId: string; body: Record<string, unknown> }>
  /** Override what GET /session/:id/message returns for a given session. */
  setMessages: (sessionId: string, msgs: unknown[]) => void
  stop: () => Promise<void>
}

export function startFakeServer(): Promise<FakeServer> {
  return new Promise((resolve) => {
    const bus = new EventEmitter()
    const sessions = new Map<string, { id: string; title: string }>()
    const messages = new Map<string, unknown[]>()
    const prompts: FakeServer['prompts'] = []
    const permissions: FakeServer['permissions'] = []
    let sseClients: http.ServerResponse[] = []
    let idCounter = 1

    const server = http.createServer((req, res) => {
      const url = req.url ?? '/'
      const method = req.method ?? 'GET'

      // SSE event stream
      if (url === '/event' && method === 'GET') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        res.write(': connected\n\n')
        sseClients.push(res)
        req.on('close', () => {
          sseClients = sseClients.filter((c) => c !== res)
        })
        return
      }

      // Collect body for POST/PATCH/DELETE
      let body = ''
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
      req.on('end', () => {
        let parsed: Record<string, unknown> = {}
        try {
          if (body) parsed = JSON.parse(body) as Record<string, unknown>
        } catch {
          /* no body */
        }

        // POST /session
        if (url === '/session' && method === 'POST') {
          const id = `sess_fake_${idCounter++}`
          const title = String(parsed.title ?? 'New session')
          sessions.set(id, { id, title })
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ id, title }))
          return
        }

        // GET /session/:id
        const getSession = url.match(/^\/session\/([^/]+)$/)
        if (getSession && method === 'GET') {
          const s = sessions.get(getSession[1])
          if (!s) { res.writeHead(404); res.end('{}'); return }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(s))
          return
        }

        // PATCH /session/:id
        const patchSession = url.match(/^\/session\/([^/]+)$/)
        if (patchSession && method === 'PATCH') {
          const s = sessions.get(patchSession[1])
          if (s && parsed.title) s.title = String(parsed.title)
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(s ?? {}))
          return
        }

        // DELETE /session/:id
        const delSession = url.match(/^\/session\/([^/]+)$/)
        if (delSession && method === 'DELETE') {
          sessions.delete(delSession[1])
          res.writeHead(204); res.end()
          return
        }

        // GET /session/:id/message
        const getMsgs = url.match(/^\/session\/([^/]+)\/message$/)
        if (getMsgs && method === 'GET') {
          const msgs = messages.get(getMsgs[1]) ?? []
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(msgs))
          return
        }

        // POST /session/:id/prompt_async
        const postPrompt = url.match(/^\/session\/([^/]+)\/prompt_async$/)
        if (postPrompt && method === 'POST') {
          prompts.push({ sessionId: postPrompt[1], body: parsed })
          bus.emit('prompt', postPrompt[1], parsed)
          res.writeHead(204); res.end()
          return
        }

        // POST /session/:id/abort
        const postAbort = url.match(/^\/session\/([^/]+)\/abort$/)
        if (postAbort && method === 'POST') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(true))
          return
        }

        // POST /session/:id/permissions/:pid
        const postPerm = url.match(/^\/session\/([^/]+)\/permissions\/([^/]+)$/)
        if (postPerm && method === 'POST') {
          permissions.push({ sessionId: postPerm[1], permId: postPerm[2], body: parsed })
          bus.emit('permission', postPerm[1], postPerm[2], parsed)
          res.writeHead(204); res.end()
          return
        }

        res.writeHead(404); res.end('not found')
      })
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      const baseUrl = `http://127.0.0.1:${addr.port}`

      resolve({
        baseUrl,
        prompts,
        permissions,
        pushEvent(evt: Record<string, unknown>) {
          const data = JSON.stringify(evt)
          const chunk = `data: ${data}\n\n`
          for (const client of sseClients) {
            try { client.write(chunk) } catch { /* client gone */ }
          }
        },
        setMessages(sessionId: string, msgs: unknown[]) {
          messages.set(sessionId, msgs)
        },
        stop() {
          return new Promise((res) => {
            for (const c of sseClients) { try { c.end() } catch { /* gone */ } }
            sseClients = []
            server.close(() => res())
          })
        },
      })
    })
  })
}

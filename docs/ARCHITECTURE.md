# Architecture

Red Sky is a two-process Electron app wrapped around a locally spawned OpenCode server. This document is the
map: what runs where, how the pieces talk, and which guarantees the sandbox actually makes.

- [Process model](#process-model)
- [Boot sequence](#boot-sequence)
- [OpenCode integration](#opencode-integration)
- [Event routing](#event-routing)
- [IPC contract](#ipc-contract)
- [Persistence](#persistence)
- [Security model](#security-model)
- [Known limitations](#known-limitations)

## Process model

```
electron/            Node main process — bundled by esbuild to dist/main.js (CommonJS)
electron/preload.ts  contextBridge shim — bundled to dist/preload.js
renderer/src/        React UI — bundled by Vite to dist/renderer/
shared/              Types + pure helpers imported by both sides
```

Three bundles, three trust levels:

1. **Main** (`electron/main.ts`) owns the window, the OpenCode child process, and every store on disk. It is
   the only process with Node and filesystem access.
2. **Preload** (`electron/preload.ts`) exposes a hand-written, allow-listed API as `window.redsky`. It is the
   entire attack surface between the UI and the machine.
3. **Renderer** (`renderer/src/`) is a normal web app. `contextIsolation` is on, `nodeIntegration` is off,
   and it cannot reach Node, Electron, or the filesystem except through `window.redsky`.

`renderer/src/api.ts` resolves the bridge as `window.redsky ?? demoApi()`. The fallback is a full in-memory
fake that lets the UI run in a plain browser tab (opening `renderer/index.html` in a browser gives you the
shell with demo data) — useful for pure-CSS and component work.

## Boot sequence

```
app.whenReady()
  ├─ createScheduler(...)      cron timer that wakes bots or fires reminders
  ├─ createAgent(deps)         bot store, memory store, SSE router
  ├─ createWindow()            BrowserWindow (frameless, 1280×840, min 960×640)
  ├─ broadcast status: starting
  └─ startServer()
       ├─ attach mode  → REDSKY_OPCODE_URL / OPENCODE_SERVER_URL
       └─ spawn mode   → opencode serve --hostname 127.0.0.1 --port 0 --print-logs
                         │
                         ├─ parse "listening on http://127.0.0.1:<port>" from stdout (45s budget)
                         ├─ write workspace/logs/server-<stamp>.info
                         ├─ agent.attach(baseUrl)
                         └─ broadcast status: online
```

Ordering matters: the window is created before the server resolves so the UI can render the `starting` state
and surface a failure as `offline` with the real error message, rather than showing a blank screen.

Shutdown is handled in `before-quit`, which stops the scheduler's timers and sends `SIGTERM` to the child.

## OpenCode integration

`electron/server.ts` is the only module that knows OpenCode exists as a process.

| Concern | Implementation |
| --- | --- |
| Binary resolution | `OPENCODE_BIN` → `where.exe opencode` / `which opencode` → on Windows, `%APPDATA%\npm\opencode.cmd` → bare `opencode`. `.cmd` shims are preferred over extension-less shims because they are what `spawn` can execute. |
| Port | `--port 0`, so the OS assigns one. The URL is scraped from stdout with two regexes (an explicit `listening on …` line, or any loopback URL). |
| Timeout | 45 seconds, then a failure that names the likely cause (not installed / not on `PATH` / not Ollama). |
| Environment | The child inherits `process.env` with `OPENCODE_DISABLE_AUTOUPDATE=1` set, and runs with `cwd` = the workspace. |
| Streaming | `GET /event` is consumed as an SSE stream, reconnecting every 1.5s while the app is alive. Each block is buffered until a blank line, then JSON-parsed; unparseable keepalives are dropped silently. |
| Attach mode | If `REDSKY_OPCODE_URL` or `OPENCODE_SERVER_URL` is set, no child is spawned — Red Sky connects to your server and everything else behaves identically. |

HTTP calls go through `electron/http.ts`, a thin `fetch` wrapper that adds basic-auth headers when
`OPENCODE_SERVER_PASSWORD` is set and unwraps OpenCode's `{ data: … }` envelopes.

### Endpoints used

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/provider` | Model picker contents. Ollama providers are filtered out on purpose. |
| `POST` | `/session` | Create one session per agent. |
| `GET` | `/session/:id` | Session title (used to auto-name an agent). |
| `GET` | `/session/:id/message` | Rehydrate a thread after a restart or a completed run. |
| `POST` | `/session/:id/prompt_async` | Dispatch a prompt (with the system prompt and model). |
| `POST` | `/session/:id/abort` | Stop the current run. |
| `DELETE` | `/session/:id` | Delete an agent and its session. |
| `PATCH` | `/session/:id` | Rename a session when an agent is renamed. |
| `POST` | `/session/:id/permissions/:permissionId` | Answer an approval request (`once` / `always` / `reject`). |
| `GET` | `/event` | SSE stream of everything above. |

## Event routing

`electron/agent.ts` keeps `sessionID → botId` (plus the reverse) and fans server events out to the right bot.
The renderer sees only a small, stable union (`EventEnvelope` in `shared/types.ts`).

| OpenCode event | Effect |
| --- | --- |
| `message.part.updated` (type `text`) | Replace that part's text and re-render the assistant turn. |
| `message.part.updated` (type `tool` / `file` / `step-start`) | Append to the agent's activity feed ("computer" trail) and set the current activity label. |
| `message.part.delta` | Append a streamed token to the part buffer and re-render. |
| `permission.asked` | Set status `waiting`, attach a `pendingPermission` card, and write an audit line. |
| `message.error` / `session.error` | Set status `error` with the server's message. |
| `session.idle` | Close the run: compute the workspace diff, collect artifacts, harvest memory, re-hydrate the thread, then emit a completion notice. |

Two details worth knowing before you touch this code:

- **Thinking is stripped at the boundary.** `shared/visible.ts` removes `<think>` blocks, reasoning fences, and
  reasoning-typed parts. Prompting alone is not trusted to keep chain-of-thought out of the UI.
- **Flushes are coalesced.** Text updates are debounced ~80ms per bot before hitting disk and the renderer, so
  a fast stream does not cause a write per token.

Run diffs work by snapshotting the workspace before a prompt and diffing after `session.idle`
(`electron/workspace.ts`), skipping `logs/`, `node_modules/`, `.git/`, and `dist/`, capped at 40 entries per
bucket. Artifacts are harvested from the activity trail and diff.

## IPC contract

The renderer's entire capability set. Every channel is a typed `ipcMain.handle`, and every push is an
`EventEnvelope`.

| Group | Channels |
| --- | --- |
| Bootstrap | `rs:init` (one call returning status, workspace, logs, models, agents, memories, routines, templates, connectors, rooms, notices, settings) |
| Agents | `rs:createBot`, `rs:renameBot`, `rs:duplicateBot`, `rs:setBotFlags` (pin/archive), `rs:listBots`, `rs:deleteBot`, `rs:setWatchMode` |
| Runs | `rs:send`, `rs:abortBot`, `rs:permission` |
| Threads | `rs:patchMessage`, `rs:deleteMessage`, `rs:clearThread`, `rs:resendFrom`, `rs:branchFrom` |
| Workspace | `rs:files`, `rs:fileContent`, `rs:search`, `rs:tool`, `rs:openWorkspace`, `rs:openLogs` |
| Memory | `rs:listMemories`, `rs:addMemory`, `rs:deleteMemory`, `rs:clearMemories` |
| Schedules | `rs:listRoutines`, `rs:addRoutine`, `rs:removeRoutine`, `rs:toggleRoutine`, `rs:teachRoutine` |
| Connectors & rooms | `rs:listConnectors`, `rs:updateConnector`, `rs:listRooms`, `rs:createRoom`, `rs:addToRoom`, `rs:renameRoom`, `rs:deleteRoom` |
| Notices | `rs:listNotices`, `rs:markNoticeRead`, `rs:markAllNoticesRead`, `rs:clearNotices` |
| Settings | `rs:getSettings`, `rs:updateSettings` |
| Window | `win:minimize`, `win:maximize`, `win:close` (fire-and-forget `send`, not `invoke`) |
| Push | `rs:event` → `status`, `bot`, `deleted`, `settings`, `connectors`, `rooms`, `teach`, `notice`, `notices`, `routines` |

Adding a channel means touching four files — the walkthrough is in
[docs/DEVELOPMENT.md](DEVELOPMENT.md#adding-an-ipc-method).

## Persistence

There is no database. Each store is a `JsonStore<T>` over one file in `userData`, written atomically
(temp file + rename, with a copy/unlink fallback for Windows) so a crash mid-write cannot corrupt state.

| Module | File | Shape |
| --- | --- | --- |
| `store.ts` | `bots.json` | `Bot[]` — the largest object in the app; also migrates the legacy `tasks.json`. |
| `settings.ts` | `settings.json` | `AppSettings`, normalized on every read so a corrupted value cannot break boot. |
| `memory.ts` | `memory.json` | `MemoryRow[]` with naive keyword scoring for recall. |
| `scheduler.ts` | `routines.json` | `Routine[]`; timers are rebuilt from disk on launch. |
| `rooms.ts` | `rooms.json` | `Room[]` — group threads. |
| `notices.ts` | `notices.json` | `AppNotice[]`, capped at 80. |
| `connectors.ts` | `connectors.json` | Overlay over a hardcoded catalog, so catalog changes ship without a migration. |
| `lib/logger.ts`, `audit.ts`, `tools.ts` | `workspace/logs/*.ndjson` | Append-only JSON Lines: app logs, audit trail, and tool in/out records. |

Errors are surfaced, not swallowed silently: logger and audit failures are caught and dropped (logging must
never break a run), while user-visible failures set `bot.status = 'error'` with the real message.

## Security model

Red Sky hands an LLM a shell. The defenses are deliberately layered:

| Layer | Mechanism |
| --- | --- |
| **Process isolation** | `contextIsolation: true`, `nodeIntegration: false`, a narrow preload allow-list, and no remote module. |
| **Workspace sandbox** | `tools.ts` normalizes every path and rejects anything that resolves outside `workspace/`, including `../` traversal and absolute paths. |
| **Destructive-command filter** | Shell calls are pattern-matched (`rm -rf /`, `format`, `diskpart`, `rd /s /q <drive>`) and refused before execution. Every call is logged either way. |
| **Auto Review** | `policy.ts` matches prompts against sensitive patterns — send/post/publish, delete/drop/wipe, spend/buy/transfer, deploy/production, grant/admin/sudo — and parks the prompt behind an approval card before it ever reaches OpenCode. Modes: `always`, `sensitive` (default), `off`. |
| **Privacy mode** | On by default. Injects a standing instruction that secrets, tokens, and personal data must not appear in logs or outbound drafts. |
| **Loopback only** | The server is started on `127.0.0.1` with a random port; nothing binds to a public interface. |
| **Audit trail** | Agent creation, deletion, permission requests, and runtime transitions are appended to `audit.ndjson`. |
| **External links** | All `window.open` traffic is denied in the renderer and handed to the OS browser. |

Auto Review is a **prompt-level** gate, not a sandbox. It is a strong speed bump against an agent talking
itself into something expensive, but it does not constrain what OpenCode does once a run starts. Treat the
workspace — not the approval card — as the security boundary.

## Known limitations

These are honest gaps, tracked on the [roadmap](../README.md#roadmap):

- **Test coverage.** `npm test` runs on Node's built-in runner and covers the Auto Review gate, reminder
  parsing, the scheduler, every JSON store (bots, rooms, memory, notices, settings, connectors), the workspace
  helpers (snapshot/diff/search), the shell sandbox and destructive-command filter, the beta setup/feedback
  helpers, the browser `demoApi` fallback, and the agent/OpenCode layer against a fake `/session` + `/event`
  server. UI-level (component) tests and the live IPC boundary are still open.
- **No renderer dev server.** `npm run dev` is a full rebuild; the main process loads a built file, not a Vite
  dev URL.
- **Connectors are a status board.** `connectors.json` records intent and feeds the system prompt; there is no
  OAuth or API integration behind it yet.
- **Browser automation is a stub.** `electron/browser.ts` describes the intended Playwright persistent-context
  design but does not launch anything.
- **Some main-process helpers are still unwired.** `importDroppedFiles` (drag-and-drop into the workspace)
  has no IPC channel or UI, and `createBrowserHandle` in `electron/browser.ts` is a stub that launches
  nothing. Wiring either up is a self-contained first contribution.
- **Schedules are in-process.** Timers live in the main process, so routines only fire while the app is
  running, and a missed window is not replayed.
- **Single window, single user.** No multi-window support and no per-user permissions on the workspace.

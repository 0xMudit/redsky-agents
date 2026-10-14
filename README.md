<div align="center">

<img src="docs/assets/logo.png" alt="Red Sky" width="128" />

<h1>Red Sky</h1>

**Grok Bot–style AI teammates that run entirely on your machine.**

Spin up a bot for Sales Outbound, Talent Scout, Paid Media, Bug Reproduction, or Chief of Staff.
Each one gets its own session, workspace, memory, and schedule — and checks back when it needs a human.

<p>
<a href="https://github.com/0xMudit/redsky-agents/actions/workflows/ci.yml"><img src="https://github.com/0xMudit/redsky-agents/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license" /></a>
<img src="https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg" alt="Node 20 or newer" />
<img src="https://img.shields.io/badge/platforms-windows%20%7C%20macos%20%7C%20linux-lightgrey.svg" alt="Windows, macOS, Linux" />
<a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome" /></a>
</p>

<img src="docs/screenshots/dashboard.png" alt="The Red Sky dashboard: agent list on the left, chat thread and live activity on the right" width="880" />

</div>

---

> **Runtime notice.** Red Sky is a desktop shell around the [OpenCode](https://opencode.ai) CLI running on your
> own machine. It is **not** Ollama, and it is not a hosted service: there is no Red Sky backend, no account,
> and no telemetry. Prompts, workspace files, and memories are stored in your Electron user-data directory —
> the only thing that crosses the network is the model call itself, to whichever provider you configured in
> OpenCode.

## Why Red Sky

Most agent tools are a chat box that forgets. Red Sky treats a bot as a **teammate with a job**: a persistent
session you can schedule, correct, and hand work to. The pieces that make that work in practice:

- **It runs local.** OpenCode on your machine, your provider keys, your files. No Red Sky service sits in the
  middle — traffic goes to your model provider, and to the network only when an agent uses a tool that needs
  it.
- **It asks before it acts.** Auto Review holds destructive, expensive, or sending work for your approval.
- **It remembers.** Durable facts survive restarts and are injected into the next run.
- **It shows its work.** Every run ends with a tool trail, a workspace diff, and a list of artifacts.
- **It stays in a sandbox.** File and shell tools are confined to a dedicated workspace directory.

## Features

| Area | What you get |
| --- | --- |
| **Agents** | Create, rename, duplicate, pin, archive, and delete bots. Each bot owns its own OpenCode session, job description, model, and color. |
| **Job templates** | Eight one-click starting points — Sales Outbound, Talent Scout, Paid Media, Expense Manager, Product Performance, Bug Reproduction, Account Health, Chief of Staff. |
| **Live threads** | Replies stream token-by-token over server-sent events as the bot works. |
| **Activity feed** | The "computer" trail lists every tool call, file touch, and shell command with the raw detail. |
| **Artifacts & diffs** | Each finished run reports files added, changed, and removed, with a file browser and inline viewer. |
| **Branching** | Fork a finished result into a new agent that takes another run at the same ask, inheriting the job and color. |
| **Memory** | Facts a bot notes with "Noted for next time:" are harvested, stored, and recalled across sessions. |
| **Conversation vault** | Every exchange is written to a markdown vault in your Documents folder, so bots recall earlier conversations and build up a running profile of you. |
| **Schedules & reminders** | Cron-style routines (`every 30 m`, `every 2 h`, `09:00`) and natural-language reminders ("remind me to reconcile spend at 9am"). |
| **Teach a routine** | Turn the task a bot just did into a recurring schedule with one click. |
| **Rooms & handoff** | Group threads where bots pass work to each other with `@Name` mentions. |
| **Auto Review** | A policy gate on destructive/expensive/sending prompts: `always`, `sensitive` (default), or `off`. |
| **Privacy mode** | On by default; tells every bot to keep secrets and personal data out of logs and outbound drafts. |
| **Connectors** | A status board for the tools a bot may use (Browser, Gmail, Calendar, Slack, GitHub, Drive, Notion). |
| **Notifications** | Desktop and in-app notices when a bot finishes, needs approval, or errors — plus unread counts per agent. |
| **Search** | Filter agents by name, job, or last result — and search inside the workspace, opening any hit in the file viewer. |
| **Appearance** | Light and dark modes (dark-first) plus seven accent themes including the clean, minimal **Mainline** — applied live and remembered per machine. |

## Screenshots

**Create an agent** — name it, give it a job, or start from a template.

![Create a new agent](docs/screenshots/create-new-agent.png)

**Edit an agent** — rename it, sharpen the job description, or swap the model.

![Edit the agent](docs/screenshots/edit-agent.png)

**Message actions** — edit, copy, delete, or branch from any turn.

![Chat options: edit, delete, update](docs/screenshots/chat-actions.png)

**Work in flight** — tool calls stream into the activity feed while the reply is still being written.

![A bot processing a task](docs/screenshots/processing.png)

**Left nav and the notification bar** — every agent, room, and schedule in one rail; every finish and
approval request in one inbox.

| Left nav bar | Notification bar |
| --- | --- |
| ![Left nav bar](docs/screenshots/left-nav-bar.png) | ![Notification bar](docs/screenshots/notification-bar.png) |

## Requirements

- **Node.js 20+** with npm
- **The OpenCode CLI on your `PATH`** — install it from <https://opencode.ai>. Red Sky spawns
  `opencode serve` itself; it never installs or vendors it.
- **A configured OpenCode model provider** (Anthropic, OpenAI, Google, …). Configure it with
  `opencode auth` or by running `opencode` once and picking a provider. Ollama is intentionally excluded
  from the model picker.

> Windows, macOS, and Linux are all supported. This is an unsigned developer build, so the OS will warn on
> first launch — see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the details.

## Quick start

```bash
# 1. Clone
git clone https://github.com/0xMudit/redsky-agents.git
cd redsky-agents

# 2. Install dependencies (also fetches the Electron binary)
npm install

# 3. Build main + preload + renderer, then launch the app
npm start
```

OpenCode boots automatically inside the app, scoped to Red Sky's workspace. When the status bar reads
**online · opencode**, create an agent and give it a task.

### First-run checklist

1. `opencode --version` works in a terminal.
2. `opencode` has a provider configured (`opencode auth`, or run `opencode` once and pick a provider + model).
3. `npm start` opens the app and the status bar turns **online**.
4. Create an agent (or pick a template), send a task, and watch it stream back.
5. Send something destructive — `delete the outbound list` — and confirm Auto Review holds it for approval.

## Configuration

Red Sky reads its environment at launch. Nothing is written back to your shell.

| Variable | Purpose |
| --- | --- |
| `OPENCODE_BIN` | Absolute path to the `opencode` binary when it is not on `PATH`. |
| `OPENCODE_SERVER_PASSWORD` | Password for an OpenCode server started with basic auth. |
| `OPENCODE_SERVER_USERNAME` | Username paired with the password (defaults to `opencode`). |
| `REDSKY_OPCODE_URL` / `OPENCODE_SERVER_URL` | Attach to an already-running OpenCode server instead of spawning one. |

```bash
# Attach to a server you started yourself, for example
REDSKY_OPCODE_URL=http://127.0.0.1:4096 npm start
```

Runtime preferences are edited in the app's **Settings** panel and applied when you press Save. The full
reference — defaults, accepted values, and where every file lands — is in
[docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Where your data lives

Everything is stored under Electron's `userData` directory and is **never** wiped between runs
(`%APPDATA%\red-sky` on Windows, `~/Library/Application Support/red-sky` on macOS,
`~/.config/red-sky` on Linux).

| Path | Contents |
| --- | --- |
| `bots.json` | Agents: names, jobs, sessions, threads, run diffs, artifacts. |
| `settings.json` | Privacy mode, Auto Review mode, handoff, parallelism. |
| `memory.json` | Durable facts harvested from replies. |
| `routines.json` | Scheduled routines and reminders. |
| `rooms.json`, `notices.json`, `connectors.json` | Group threads, notification inbox, connector status board. |
| `workspace/` | The sandboxed directory every file and shell tool is confined to. |
| `workspace/logs/` | `app.ndjson`, `tools.ndjson`, `audit.ndjson`, and `server-*.info` for each boot. |

Use **Open Workspace** and **Open Logs** in the app to jump straight to either directory.

Separately, Red Sky keeps a **conversation vault** in your Documents folder (`Documents/Red Sky` on Windows
and macOS, `~/Documents/Red Sky` on Linux). It records every message you and a teammate exchange — raw
transcripts in `raw/`, a readable page per teammate in `conversations/`, a catalog in `index.md`, a
chronological `log.md`, and a growing `profile.md` of what is known about you. Relevant parts are recalled
into the next run, so a bot remembers earlier conversations across restarts. It is plain markdown you can
read, back up, or delete at any time, and it stays out of your working files.

## How it works

```
┌──────────────────────────────────────────── Electron ────────────────────────────────────────────┐
│  Renderer (React 19 + Tailwind 4, Vite)          Main process (Node, esbuild → CJS)              │
│  ├─ agent rail, chat threads, activity feed      ├─ agent.ts     bot lifecycle + SSE routing     │
│  ├─ memory / routines / connectors / settings    ├─ server.ts    spawns & supervises OpenCode    │
│  └─ window.redsky  ──  contextBridge ──▶  IPC    ├─ scheduler.ts cron + reminders                │
│                        `rs:*` invoke  ◀── `rs:event` pushes ◀──  policy.ts    Auto Review gate   │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                              │ HTTP + SSE
                                                              ▼
                                          OpenCode server (opencode serve, 127.0.0.1:random)
                                                              │
                                                              ▼
                                             workspace/  ← sandboxed file & shell tools
```

The main process starts `opencode serve --hostname 127.0.0.1 --port 0` with the workspace as its working
directory, parses the port from stdout, then subscribes to `/event`. Each OpenCode `sessionID` is mapped to a
bot, so `message.part.delta` events become streaming text, `permission.asked` becomes an approval card, and
`session.idle` closes the run — computing the workspace diff, collecting artifacts, and harvesting memory.
The renderer never talks to OpenCode directly; it calls typed `rs:*` IPC handlers through
`window.redsky`, and receives a stream of `EventEnvelope` pushes over `rs:event`.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full module map, event contract, and security model.

## Project layout

```
electron/        Main process: OpenCode supervision, agent lifecycle, stores, scheduler
  lib/           Shared internals (atomic JSON persistence, ids, logger)
renderer/src/    React UI — App.tsx (shell), ui.tsx (components), api.ts (bridge + demo adapter)
shared/          Types and helpers used by both processes
docs/            Architecture, configuration, development guides, screenshots
build.mjs        esbuild bundles for the main and preload processes
vite.config.ts   Renderer bundle (root: renderer/, out: dist/renderer)
```

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Build everything, then launch Electron. |
| `npm run dev` | Alias of `npm start` — there is no separate dev server today (see [Roadmap](#roadmap)). |
| `npm run build` | Build main + preload + renderer into `dist/` without launching. |
| `npm run typecheck` | Type-check the whole codebase with `tsc --noEmit`. |
| `npm test` | Bundle and run the test suites on Node's built-in test runner. |
| `npm run build:test` | Bundle `test/*.test.ts` into `build-tests/suite.test.cjs` without running them. |

CI runs `typecheck`, `build`, and `test` on Linux (Node 20 and 22), Windows (Node 20), and macOS (Node 20).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Status stuck on **starting**, times out after 45s | `opencode` is not on `PATH`. Install it from <https://opencode.ai> (it is not Ollama), then relaunch — or set `OPENCODE_BIN`. |
| **offline · opencode exited** | The OpenCode server crashed on launch. Check `workspace/logs/server-*.info`, then [open an issue](https://github.com/0xMudit/redsky-agents/issues). |
| "OpenCode did not return a session id" | The server started but did not answer `/session`. Confirm a provider is authenticated (`opencode auth`). |
| Model picker is empty | No provider is connected, or only Ollama is configured — Ollama is deliberately excluded. |
| A run is hanging on an approval card | A bot is waiting on you. Choose **once** / **always**, or reject it in the chat. |
| Build errors after pulling | `npm install`, then `npm run typecheck`. |

More in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and the [issue tracker](https://github.com/0xMudit/redsky-agents/issues).

## Roadmap

- Renderer dev server with hot reload (the current `npm run dev` is a full rebuild).
- Real connector implementations behind the status board — the board tracks intent, not OAuth yet.
- Browser automation via a persistent Playwright profile (`electron/browser.ts` is a stub).
- Downloadable installers with code signing for each platform.
- Broader test coverage. The harness covers the JSON stores, the agent/OpenCode layer (against a fake
  `/session` + `/event` server), the workspace helpers, the shell sandbox, and the scheduler; UI-level
  (component) tests and the live IPC boundary are still open.
- Window-level drag-and-drop of files onto the app (the composer's attach button already copies files into
  `workspace/inbox` via `rs:importFiles`), and a DevTools toggle
  for the frameless window. See [Known limitations](docs/ARCHITECTURE.md#known-limitations).
- Cloud capabilities — persistent per-bot computers, a 24/7 hosted runtime, mobile clients, teach-by-showing,
  cross-bot knowledge, and a durable handoff queue — are scaffolded and typed end to end. See
  [docs/FEATURES-CLOUD.md](docs/FEATURES-CLOUD.md) for the assignments.

## Contributing

Contributions are welcome — issues, docs, and pull requests alike. Start with
[CONTRIBUTING.md](CONTRIBUTING.md), which covers setup, branch and commit conventions, and what a reviewable
PR looks like. Please also read the [Code of Conduct](CODE_OF_CONDUCT.md); it applies to every project space.

Good first issues are labelled [`good first issue`](https://github.com/0xMudit/redsky-agents/labels/good%20first%20issue).
The roadmap items above are a fair summary of where help is most useful.

## Security

Red Sky runs an agent with shell access inside a sandboxed workspace. That is a power worth respecting.
Please report vulnerabilities privately per [SECURITY.md](SECURITY.md) rather than in a public issue.

## License

[MIT](LICENSE) © 2026 Muditya Raghav. OpenCode is a separate project under its own license.

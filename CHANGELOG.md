# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- One-click installers for a beta launch: `electron-builder` packaging (`npm run dist`) producing NSIS, DMG, and
  AppImage artifacts, plus a tag-triggered release workflow (`.github/workflows/release.yml`) that builds per-OS
  and attaches them to a GitHub Release.
- First-run setup checklist in the composer area: reports whether the OpenCode CLI is on `PATH`, whether a model
  provider is configured, and whether the server is connected, with links to fix each gap.
- Beta feedback button in the header that opens a prefilled GitHub issue, including app version, platform,
  setup status, and a redacted tail of the run log.
- Test harness on Node's built-in test runner (`npm test`), with esbuild bundling and an Electron double so
  main-process modules run under plain `node --test`. Suites cover the Auto Review gate, reminder parsing, and
  the scheduler — including routine firing, disk rehydration, and reminder dedupe.
- Pinned and archived agents, exposed through the agent editor: pinned agents sort first, archived ones dim
  and sink to the bottom.
- Thread branching — any finished result can fork a new agent that takes another run at the same ask, carrying
  the job and color over.
- Workspace search in the sidebar: query the contents of the workspace and open a hit directly in the file
  viewer.
- Open-source scaffolding: [MIT license](LICENSE), [contributing guide](CONTRIBUTING.md),
  [code of conduct](CODE_OF_CONDUCT.md), [security policy](SECURITY.md), issue forms, a PR template, and
  GitHub Actions CI running typecheck and build on Linux, Windows, and macOS for Node 20 and 22.
- Documentation set under `docs/`: [architecture](docs/ARCHITECTURE.md),
  [configuration reference](docs/CONFIGURATION.md), and [development guide](docs/DEVELOPMENT.md).
- Screenshots covering the dashboard, agent creation and editing, chat actions, navigation, the notification
  bar, and a run in flight.

### Changed

- README rewritten as a project front door: requirements, quick start, feature overview, configuration, data
  locations, scripts, troubleshooting, and roadmap.
- Product name standardized on "Red Sky"; logo and screenshots moved under `docs/`.
- CI now runs `npm test` alongside typecheck and build on all three platforms.

### Fixed

- `nextDelayMs` rejected the plural hour unit, so `every 4 hrs` was refused while `every 4 hr` worked. The
  plural is now accepted, matching the minute units.

### Removed

- The "private repository — all rights reserved" notice. Red Sky is now MIT licensed.

## [0.2.0] - 2026-09-20

The first version of Red Sky: a desktop shell around a locally spawned OpenCode server.

### Added

- **Agents** — create, rename, duplicate, and delete bots, each with its own OpenCode session, job
  description, model, and color.
- **Job templates** — eight one-click starting points: Sales Outbound, Talent Scout, Paid Media, Expense
  Manager, Product Performance, Bug Reproduction, Account Health, and Chief of Staff.
- **Streaming threads** — assistant replies stream in token-by-token over server-sent events, with
  reasoning/`<think>` content stripped before it reaches the UI.
- **Live activity feed** — a per-run trail of tool calls, file touches, and shell commands.
- **Run diffs and artifacts** — added, changed, and removed files per run, with a workspace browser and file
  viewer.
- **Memory** — durable facts harvested from replies ("Noted for next time: …") and recalled across sessions.
- **Schedules** — `every 30 m` / `every 2 h` / `09:00` routines, natural-language reminders, and a
  "teach a routine" flow.
- **Rooms and handoff** — group threads where agents pass work to each other with `@Name` mentions.
- **Auto Review** — an approval gate for destructive, expensive, or outbound prompts, with `always`,
  `sensitive`, and `off` modes.
- **Privacy mode** — on by default; keeps secrets and personal data out of logs and outbound drafts.
- **Connectors** — a status board that tells agents which external tools they may use.
- **Notifications** — desktop and in-app notices when an agent finishes, needs approval, or errors.
- **Sandboxed tools** — file and shell tools confined to the workspace, with path-escape guards, a
  destructive-command filter, and JSON Lines logging of every call.
- **Settings** — privacy, Auto Review mode, handoff, and parallelism, plus **Open Workspace** /
  **Open Logs** shortcuts.

[Unreleased]: https://github.com/0xMudit/redsky-agents/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/0xMudit/redsky-agents/releases/tag/v0.2.0

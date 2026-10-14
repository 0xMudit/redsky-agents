# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Conversation vault** — every exchange between you and a teammate is written, in the background, to a
  markdown knowledge vault in your Documents folder (`Documents/Red Sky/`). Raw transcripts stay immutable in
  `raw/`, a readable page per teammate is derived into `conversations/`, and `index.md` + `log.md` keep the
  record navigable — the "LLM wiki" pattern. At the start of a run, relevant turns from past sessions plus a
  running user profile (`profile.md`, fed by the durable facts bots already note) are recalled with an
  in-process keyword index and folded into the system prompt, so a bot picks up where an earlier conversation
  left off without re-indexing on every question.
- One-click installers for a beta launch: `electron-builder` packaging (`npm run dist`) producing NSIS, DMG, and
  AppImage artifacts, plus a tag-triggered release workflow (`.github/workflows/release.yml`) that builds per-OS
  and attaches them to a GitHub Release.
- First-run setup gate: a centered, blocking overlay with a spinner reports whether the OpenCode CLI is on
  `PATH`, whether a model provider is configured, and whether the server is connected, with a link to fix the
  provider gap. It re-checks every few seconds and pauses all actions until setup is complete.
- Beta feedback button in the header that opens a prefilled GitHub issue, including app version, platform,
  setup status, and a redacted tail of the run log.
- Test harness on Node's built-in test runner (`npm test`), with esbuild bundling and an Electron double so
  main-process modules run under plain `node --test`. Suites cover the JSON stores, the agent/OpenCode layer
  against a fake `/session` + `/event` server, the workspace helpers, the shell sandbox, the scheduler
  (including routine firing, disk rehydration, and reminder dedupe), and the browser `demoApi` fallback.
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
- **Command palette** (`Cmd/Ctrl+K`) — one search box over actions, panels, agents, templates, quick replies,
  and accent themes, with arrow-key navigation, grouped results, and inline keyboard hints.
- **Keyboard shortcuts** — `Cmd/Ctrl+N` for a new agent, `Cmd/Ctrl+B` to toggle the activity panel, and the
  existing `J`/`↓` to jump to the next unread agent; a `Commands` button in the header advertises the palette.
- **Accent themes** — seven palettes (Coral, Aurora, Emerald, Amber, Rose, Ice, and the clean, minimal
  Mainline) selectable from Settings or the command palette and remembered in `localStorage`, applied without
  reloading.
- **Light and dark modes** — the app ships dark-first, and now that every surface is tokenized it can flip to
  a light mode from the moon/sun button in the header, Settings → Appearance, or the command palette. Each
  accent theme re-tints automatically for the active mode, and the choice persists.
- **Collapsible app tools** — Rooms, Schedules, Memory, History, Connectors, and Settings hide under a single
  chevron in the sidebar, so the agent list keeps the focus. The drawer state is remembered per machine.
- Syntax-highlighted fenced code in replies, wrapped with a language label and a one-click **Copy** button.
- Richer run activity: tool calls render as a connected timeline, run results gain count chips and a
  completion burst, and streamed replies carry a live caret.
- Onboarding polish: a typewriter hero, the current team as one-tap chips, and template cards that lift on
  hover, all with staggered entrance motion.
- Browser-local persistence for the web demo: the demo adapter now keeps agents, threads, settings, rooms,
  and connectors in `localStorage` (versioned key `redsky.demo.v1`, debounced writes, corrupt-safe), so a
  reload picks up where you left off; a bot caught mid-run rehydrates to idle.
- **Agent context menu** — right-click any agent in the sidebar (or use its hover `⋯` button) to open, rename
  inline, edit, duplicate, pin/unpin, toggle workspace watching, archive/unarchive, clear the chat, or delete.
- **Drag-and-drop agent ordering** — drag agents in the sidebar to arrange them; the order persists per agent
  (new field `order`), and dropping works within the pinned/unpinned/archived groups. A newly created agent
  still lands on top.
- **Life tips while an agent works** — sending a prompt now shows one small window with a softly orbiting,
  accent-tinted animation instead of a stream of "thinking"/"working" text. It rotates a short model-written
  tip for getting better at life. Tips are generated by the model through the local OpenCode server (in a
  throwaway session kept out of the agent list), cached in memory, and warmed at startup so the first send
  already has one; a bundled fallback keeps the window non-empty if no model is reachable.
- **Global search** — a search button in the header (beside the theme toggle) opens a command-palette-style
  modal that queries everything at once — agents, chat history, workspace files, and notes — grouped by kind
  with keyboard navigation, alongside the existing sidebar agent/workspace search.
- **Composer attachments** — the composer's plus button opens a file/image picker (10 MB cap); picked files
  are copied into `workspace/inbox` through a new `rs:importFiles` IPC channel and handed to the agent as
  workspace-relative paths to read. Chips in the composer show each attachment's name and let you remove it.
- **Model picker in Settings** — the active model moved out of the header into a dedicated Settings section.
- **Base themes + font scale** — appearance now has two independent axes: a tweakcn *base theme* (Supabase
  default, plus Notebook, Mono, Sage Garden, Catppuccin, Amber Minimal, Claude, and T3 Chat) that owns
  surfaces, type, and radius, and the existing brand accent that owns `--accent`; a whole-UI font-size control
  (`A−`/`A+`) scales the interface. Both persist per machine.

### Changed

- README rewritten as a project front door: requirements, quick start, feature overview, configuration, data
  locations, scripts, troubleshooting, and roadmap.
- Product name standardized on "Red Sky"; logo and screenshots moved under `docs/`.
- CI now runs `npm test` alongside typecheck and build on all three platforms.
- Interface widened with motion and depth: animated message blocks, a spotlit primary action, a post-run
  observation orbit, and softer shadows throughout.

### Fixed

- Activity feed no longer leaks raw protocol events: `step-start`/`step-finish` parts are dropped, tool
  details render as readable text instead of `[object Object]`, and repeated identical events collapse.
  While a run is in flight the thread shows the animated working window and the feed shows a single spinner
  instead of a scrolling event list.
- The composer's busy state no longer spins a hardcoded rainbow border on send; it now breathes a soft
  accent-tinted ring that follows the active theme.
- Browser demo agents now get collision-safe ids — several created within the same millisecond (rapid clicks)
  previously shared a `Date.now()`-derived id and could be selected or reordered as one.
- Web demo didn't re-render sent prompts or replies: the demo adapter mutated bot/room/connector objects
  in place, so React saw unchanged references and memoized selectors never recomputed. It now swaps in fresh
  objects on every change, matching the live bridge's clone-per-event behaviour.
- `nextDelayMs` rejected the plural hour unit, so `every 4 hrs` was refused while `every 4 hr` worked. The
  plural is now accepted, matching the minute units.
- Run diffs listed the whole workspace instead of only the files a run touched: the pre-run snapshot was
  never captured, so the baseline was always empty. The snapshot is now taken when a run starts, and a
  regression test asserts that pre-existing files are not reported as added.
- The destructive-command filter's `expand-archive` pattern was malformed and could never match. The filter
  now covers `rm -rf` aimed at a root/home/wildcard target, format/partition tools, drive-root deletes,
  raw-device writes, and fork bombs.

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

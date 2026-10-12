# Configuration

Two kinds of configuration exist: **environment variables**, read once at launch, and **app settings**,
edited in the Settings panel and persisted to disk.

- [Environment variables](#environment-variables)
- [App settings](#app-settings)
- [Auto Review policy](#auto-review-policy)
- [Connectors](#connectors)
- [Schedules and reminders](#schedules-and-reminders)
- [Data locations](#data-locations)
- [Logs](#logs)

## Environment variables

Red Sky reads these from the process environment. It does **not** load a `.env` file — export them in your
shell, or set them in the task that launches the app.

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENCODE_BIN` | No | Absolute path to the `opencode` binary. Use it when OpenCode is installed somewhere `PATH` does not cover, or to pin a specific build. Checked before any `PATH` lookup. |
| `OPENCODE_SERVER_PASSWORD` | No | Password for an OpenCode server that requires basic auth. When set, Red Sky sends an `Authorization: Basic …` header on every HTTP and SSE request. |
| `OPENCODE_SERVER_USERNAME` | No | Username paired with the password above. Defaults to `opencode`. Only read when the password is set. |
| `REDSKY_OPCODE_URL` | No | URL of an already-running OpenCode server. Setting it skips spawning entirely. |
| `OPENCODE_SERVER_URL` | No | Alias for `REDSKY_OPCODE_URL`; the first one that is set wins. |

Red Sky sets `OPENCODE_DISABLE_AUTOUPDATE=1` on the child process it spawns, so a running app never
self-updates OpenCode underneath you.

### Attaching to your own server

Useful when you want OpenCode running with your own flags, or want to inspect the server directly.

```bash
# Terminal 1 — start OpenCode yourself, bound to loopback
opencode serve --hostname 127.0.0.1 --port 4096

# Terminal 2 — point Red Sky at it instead of spawning a child
REDSKY_OPCODE_URL=http://127.0.0.1:4096 npm start
```

In attach mode Red Sky never kills the server on quit, and the status bar shows the URL it connected to.
The workspace it hands to OpenCode is still Red Sky's own `workspace/` directory, so a server started from a
different working directory will still be scoped there for file and shell work.

### Binary resolution order

If `OPENCODE_BIN` is unset, Red Sky tries in order:

1. `where.exe opencode` (Windows) or `which opencode` (macOS/Linux).
2. `%APPDATA%\npm\opencode.cmd`, then `%APPDATA%\npm\opencode` (Windows only).
3. Bare `opencode` / `opencode.cmd`, letting the shell resolve it.

`.cmd` shims are preferred on Windows because they are what `spawn` can execute without a shell.

## App settings

Stored in `settings.json` and normalized on every read, so a hand-edited or corrupted file cannot break
startup. Changes are applied when you press **Save** in the Settings panel.

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `privacyMode` | boolean | `true` | Injects "do not copy secrets, tokens, or personal data into logs or outbound drafts" into every agent's system prompt. |
| `autoReview` | `"always"` \| `"sensitive"` \| `"off"` | `"sensitive"` | Prompt-level approval gate. See [Auto Review policy](#auto-review-policy). |
| `allowBotHandoff` | boolean | `true` | Lets agents hand work to each other with `@Name` mentions, and advertises the peer list in the system prompt. |
| `maxParallelBots` | number, 1–32 | `8` | Refuses a new run once this many agents are working. Out-of-range values are clamped. |
| `defaultModel` | string | unset | Reserved. The model picker persists the per-agent choice on the agent itself. |
| `speakResults` | boolean | `false` | Reserved for spoken summaries. |
| `lastDigestAt` | number | unset | Reserved for the digest notice. |

Reserved keys are read and written but not surfaced in the UI — don't build on them yet.

## Appearance

Renderer-only preferences, stored in `localStorage` (per machine) rather than `settings.json`. They live at
startup on the page and apply instantly without a reload.

| Preference | Keys | Options | Default |
| --- | --- | --- | --- |
| Mode | `redsky.mode` | `dark` \| `light` | `dark` |
| Accent theme | `redsky.theme` | `mainline`, `coral`, `aurora`, `emerald`, `amber`, `rose`, `ice` | `coral` |
| App tools drawer | `redsky.sections` | `0` (collapsed) \| `1` (open) | open |

Switch mode from the moon/sun button in the header, **Settings → Appearance**, or the command palette
(`Cmd/Ctrl+K`). The accent swatches tint whichever mode is active — **Mainline** is the clean, minimal
graphite palette. The **App tools drawer** (Rooms, Schedules, Memory, History, Connectors, Settings) collapses
to a single chevron in the sidebar with the `−` button at its top-right corner.

## Auto Review policy

`electron/policy.ts` matches the prompt you send against sensitive patterns before it reaches OpenCode:

| Pattern group | Examples matched |
| --- | --- |
| Outbound | `send`, `email`, `mail`, `slack`, `post`, `tweet`, `publish` |
| Destructive | `delete`, `rm -rf`, `drop table`, `wipe` |
| Money | `spend`, `purchase`, `buy`, `charge`, `wire`, `transfer`, `invoice` |
| Production | `deploy`, `prod`, `production`, `drop index` |
| Privilege | `grant`, `revoke`, `admin`, `sudo` |

Mode behavior:

- `always` — every prompt is held for approval.
- `sensitive` *(default)* — only prompts matching the patterns above are held.
- `off` — nothing is held. The bot-level `permission.asked` prompts from OpenCode still apply.

When a prompt is held, the agent flips to `waiting` and an approval card explains which pattern matched.
Approve **once** to run it, **always** to run it without being asked again for that prompt, or reject it to
discard the queued prompt and return the agent to idle.

> Auto Review is a speed bump, not a sandbox. It governs what you *ask* for. It does not constrain what
> OpenCode does once a run is under way — see the [security model](ARCHITECTURE.md#security-model).

## Connectors

The Connectors panel is a status board over a fixed catalog. Marking a connector **connected** adds it, by
name and description, to every agent's system prompt; nothing else changes, and no credentials are involved.

| Id | Name | Description shown to agents |
| --- | --- | --- |
| `browser` | Browser | Use sites the way you would, including tools that are harder to navigate. |
| `gmail` | Gmail | Read and draft mail. Sending stays behind Auto Review. |
| `calendar` | Calendar | Look up time and draft events; confirm before booking. |
| `slack` | Slack | Search threads and draft replies across workspaces you connect. |
| `github` | GitHub | Read issues and PRs, then hand coding work to a specialist bot. |
| `drive` | Drive | Search docs and pull context into the workspace. |
| `notion` | Notion | Search wikis and design docs your team already wrote. |

Status is one of `disconnected` (default), `connected`, or `error`, plus an optional note. With nothing
connected, agents are told to stay in the local workspace.

## Schedules and reminders

Schedules accept three shapes, parsed in `electron/scheduler.ts`:

| Form | Example | Meaning |
| --- | --- | --- |
| Interval, minutes | `every 30 m`, `every 15 minutes`, `every 2 mins` | Repeats every 30 / 15 / 2 minutes. |
| Interval, hours | `every 2 h`, `every 1 hour`, `every 4 hrs` | Repeats every 2 / 1 / 4 hours. |
| Daily clock time | `09:00`, `daily 09:30` | Fires at that local time; if it already passed today, tomorrow. |

Seconds are not supported — one minute is the smallest interval — and the hour/minute unit must be one of
`m`, `min`, `mins`, `minute`, `minutes`, `h`, `hr`, `hrs`, `hour`, `hours`. Anything else is rejected with:
*"unrecognized schedule — use `every 30 m`, `every 2 h`, or `09:00`"*.

Timers live in the main process and are rebuilt from `routines.json` on launch, so routines only fire while
the app is running. A window missed while the app was closed is not replayed. If a routine is still firing
when its next tick arrives, the tick is skipped rather than overlapped.

**Natural-language reminders** are parsed from the prompt itself (`electron/remind.ts`), so you never have to
open the Routines panel. For example:

```
remind me to reconcile ad spend at 9am
keep reminding me to check the pipeline every 2 hours
```

The prompt must contain the word **remind** or **reminder**, and must carry a parseable schedule — otherwise
it is treated as an ordinary task and nothing is scheduled. Times accept `9am`, `9:30pm`, `09:00`, and `12am`
is midnight.

The agent replies with a confirmation, a desktop notification is registered, and the reminder appears in the
Routines panel with `origin: "reminder"`. To cancel, say *stop reminding me*, *cancel reminders*,
*no more reminders*, or *don't remind me*. Scheduling the same reminder text again replaces the previous one.

**Teach a routine** captures the last prompt you sent to an agent and turns it into a recurring schedule with
`origin: "taught"`.

## Data locations

Everything lives under Electron's `userData` directory and survives restarts, upgrades, and uninstalls.

| Platform | Directory |
| --- | --- |
| Windows | `%APPDATA%\red-sky` |
| macOS | `~/Library/Application Support/red-sky` |
| Linux | `~/.config/red-sky` |

| File | Contents |
| --- | --- |
| `bots.json` | Agents, their sessions, threads, activity trails, run diffs, and artifacts. |
| `settings.json` | The settings table above. |
| `memory.json` | Durable facts harvested from replies. |
| `routines.json` | Routines and reminders. |
| `rooms.json` | Group threads and participants. |
| `notices.json` | Notification inbox, capped at the newest 80. |
| `connectors.json` | Connector status overlay over the catalog. |
| `workspace/` | The sandboxed directory all file and shell tools are confined to. |
| `workspace/logs/` | Append-only run logs (below). |
| `workspace/inbox/` | Files dropped into the app, stored with a timestamp prefix. *Not yet reachable — the import helper has no UI or IPC channel; see [Known limitations](ARCHITECTURE.md#known-limitations).* |

Deleting `bots.json` (or the whole directory) resets Red Sky. To start over but keep your scheduled work,
delete `bots.json` alone and expect the routines that referenced those agents to be pruned on the next launch.

Use **Open Workspace** and **Open Logs** in the app to open either directory in your file manager.

## Logs

All four files are JSON Lines — one JSON object per line — so `jq` and most log viewers read them directly.

| File | Shape | Written by |
| --- | --- | --- |
| `app.ndjson` | `{ ts, level, msg, ctx }` | Main-process logger. Errors are also mirrored to stderr. |
| `tools.ndjson` | `{ ts, tool, input, output, error }` | `electron/tools.ts`, for every file read, write, and shell call. |
| `audit.ndjson` | `{ ts, event, … }` | Agent creation, deletion, permission requests, runtime transitions. |
| `server-<stamp>.info` | `listening at <url>` | One per boot; the first thing to check when the app goes `offline`. |

Handy one-liners:

```bash
# Errors from the last run
jq -c 'select(.level=="error")' "$APPDATA/red-sky/workspace/logs/app.ndjson"   # Windows (Git Bash)
tail -f ~/.config/red-sky/workspace/logs/app.ndjson                            # Linux / macOS

# Every shell command an agent ran, newest last
jq -c 'select(.tool=="run_shell") | .input' ~/.config/red-sky/workspace/logs/tools.ndjson
```

Logs are never pruned automatically. They are plain files — delete them whenever you like.

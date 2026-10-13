# Cloud capabilities

Red Sky is local-first by design: OpenCode runs on your machine, stores live in `userData`, and no Red Sky
service sits in the middle. This document covers the **cloud-facing capabilities** that have been scaffolded on
top of that base — the plumbing is in place and typed end to end, and each one has a clear owner-shaped
"what's left" list.

Read this alongside [ARCHITECTURE.md](ARCHITECTURE.md) (module map, IPC contract, security model) and
[DEVELOPMENT.md](DEVELOPMENT.md#adding-an-ipc-method) (how to add an IPC method).

> **Status.** Everything here is wired but not yet connected to real cloud infrastructure. The **local** runtime
> is functional against the in-process OpenCode server; the **hosted** runtime is a deliberate stub. The
> renderer can already call every channel below through `window.redsky`; there is no dedicated UI panel yet.

## The runtime seam

The central idea is that a bot's "computer" and the thing that keeps it running should not care whether they
live in this process or on a server. That seam is `CloudRuntime` (`electron/cloud/runtime.ts`):

```ts
interface CloudRuntime {
  readonly kind: 'local' | 'hosted'
  status: () => CloudRuntimeStatus
  start: () => Promise<void>
  stop: () => Promise<void>
  endpoint: () => string | null
}
```

- `createLocalRuntime()` — wraps today's behaviour. `main.ts` drives it through the boot sequence
  (`starting → ready` on success, `offline` when OpenCode is missing, `degraded` on a startup failure) and calls
  `markState` so the status is available over IPC.
- `createHostedRuntime()` — the assignment. Every method throws or reports `offline`; the shape exists so the
  renderer, stores, and IPC could be built before the service does.
- `createCloudRuntime(kind)` — the factory. Switch it to hand back the hosted runtime once it exists.

The current runtime is local; see `cloud.status()` from the renderer.

## Capability map

| # | Capability | Module(s) | IPC channels | State |
| --- | --- | --- | --- | --- |
| 1 | Persistent computer per bot | `cloud/computer.ts` | `ensureComputer`, `stopComputer`, `listComputers` | Local: works. Hosted: TODO |
| 2 | 24/7 runtime | `cloud/runtime.ts` | `cloudStatus` | Local: works. Hosted: stub |
| 3 | Desktop + iOS clients | `cloud/devices.ts` | `registerDevice`, `removeDevice`, `listDevices` | Registry: works. iOS app: TODO |
| 4 | Multi-bot collaboration | `rooms.ts` + `cloud/handoff.ts` | existing rooms + `queueHandoff`, `listHandoffs` | Rooms: works. Durable handoff: works locally |
| 5 | Teach by showing | `cloud/recording.ts` + `agent.ts` | `startRecording`, `captureRecording`, `stopRecording`, `saveRecordingAsRoutine` | Live capture: works. Editing a draft: TODO |
| 6 | Scheduled routines | `scheduler.ts` (+ #5) | existing routines + `saveRecordingAsRoutine` | In-process. 24/7 scheduling: TODO |
| 7 | Cross-bot learning | `cloud/federation.ts` + `memory.ts` | `publishFact`, `listFederated`, `forgetFact` | Prompt injection: works. Share controls: TODO |
| 8 | Bot-to-bot handoffs | `cloud/handoff.ts` + `collab.ts` | `queueHandoff`, `listHandoffs` | Auto-dispatch + loop guard: works. Retry/UI: TODO |

Shared shapes live in `shared/cloud.ts`; the renderer sees them re-exported from `shared/types.ts`. New stores
follow the `JsonStore` pattern in `electron/lib/persist.ts` and land in `userData` (listed in
[CONFIGURATION.md](CONFIGURATION.md#data-locations)).

---

## 1. Persistent computer per bot

**Today.** Every bot can own a directory at `workspace/.computers/<botId>` that survives runs. `ensure()`
provisions it idempotently, `stop()` powers it down without deleting it, and the record keeps a count of saved
logins. Credential **labels** are stored; secret values are never persisted here or sent to the renderer.

**Files.** `electron/cloud/computer.ts` (`ComputerStore`, `CloudComputer` in `shared/cloud.ts`).

**Left to do.**

- Persist real credentials in the OS keychain (Windows Credential Manager / macOS Keychain / libsecret) or the
  hosted secret store, behind `addCredential`. The store currently records only the label.
- Point an agent's file/shell tools at its computer root instead of the shared workspace
  (`electron/tools.ts`, `electron/agent.ts`).
- Move the computer onto the hosted runtime when `kind === 'hosted'`.
- A UI: per-bot computer status card, a "start/stop" control, and a credential list.

## 2. 24/7 runtime

**Today.** `CloudRuntime` abstracts where bots run. The local implementation is live and reflects boot state;
the hosted one is a stub.

**Files.** `electron/cloud/runtime.ts`.

**Left to do.**

- Implement `HostedRuntime`: `start()` authenticates and provisions, `endpoint()` returns the API base URL,
  `status()` reflects a real heartbeat. Sketch the HTTP/SSE contract (auth, heartbeat, prompt dispatch) or reuse
  `electron/http.ts`.
- Route `agent.send` and the scheduler through the runtime instead of assuming a local `baseUrl`.
- A keep-alive policy so a bot keeps running when the desktop app is closed (`Presence.keepAlive` in
  `shared/cloud.ts` is the placeholder).
- Reconnect/backoff so a laptop sleep does not drop a run.

## 3. Desktop + iOS clients

**Today.** A device registry records attached clients (name, platform, last-seen, push). The desktop app seeds
itself; `register()` is the seam an iOS client will call.

**Files.** `electron/cloud/devices.ts` (`DeviceStore`, `DeviceClient`).

**Left to do.**

- Build the iOS client. The web build (`web/`) already reuses the renderer with a different bridge
  (`web/lib/webApi.ts`), so a SwiftUI/React-Native shell talking to `HostedRuntime` is the natural path.
- Real authentication for `register()` — the registry trusts whoever calls it today.
- Liveness: `touch()` on a heartbeat, and a "stale device" sweep.
- Push notifications per device (`DeviceClient.push`).

## 4. Multi-bot collaboration

**Today.** Rooms (`electron/rooms.ts`) already hold group threads and `collab.ts` parses `@Name` mentions and
builds a handoff prompt. The new `HandoffStore` adds a durable record of who passed what to whom.

**Files.** `electron/rooms.ts`, `electron/collab.ts`, `electron/cloud/handoff.ts`.

**Left to do.**

- Represent a room's work as a stream of handoffs so the trail survives a restart.
- Fan-out: one message to several participants, with per-bot results collected back into the room.
- A conflict/ordering policy when two bots edit the same artifact.

## 5. Teach by showing

**Today.** A recording is an ordered list of steps. Starting one seeds a per-bot cursor in `main.ts`, and every
bot event diffs new activity into steps through `captureRecordingSteps()` (pure, tested) — user prompts and
`ComputerEvent`s (tools, files, shell, handoffs) are captured live, in time order, each exactly once.
`draftRoutineFromRecording()` (pure, tested) turns the result into the prompt a routine replays, and
`saveRecordingAsRoutine` pairs it with a schedule from the existing scheduler.

**Files.** `electron/cloud/recording.ts` (`RecordingStore`, `captureRecordingSteps`, `draftRoutineFromRecording`),
`electron/main.ts` (cursor seeding + `captureForRecording`).

**Left to do.**

- Let the preview be edited before it becomes a routine (drop steps, reorder, annotate).
- Generalize the prompt composition once real recordings exist; the current heuristic is intentionally simple.

## 6. Scheduled routines

**Today.** `electron/scheduler.ts` owns cron-style routines and reminders, persisted to `routines.json`. This
capability predates the cloud work; the cloud angle is making routines fire when the app is closed.

**Files.** `electron/scheduler.ts`, `shared/types.ts` (`Routine.origin` is `manual | taught | reminder`).

**Left to do.**

- Hand scheduling to the hosted runtime so a routine fires 24/7 (see #2) instead of only while the app runs.
- Replay a window missed while offline.
- Timezones and per-routine enabled windows.

## 7. Cross-bot learning

**Today.** `memory.ts` harvests durable facts per bot. `FederationStore` is the shared layer above it: a fact
can be published fleet-wide or to a chosen set, and `factVisibleTo()` (pure, tested) is the read rule — a bot
always sees what it learned, and a fact with no `sharedWith` is public. The agent wires both directions: facts it
harvests are auto-published (`harvestAndTeach`), and facts other bots learned are folded into `buildSystem()` so a
bot actually *uses* the fleet's knowledge.

**Files.** `electron/cloud/federation.ts` + `electron/memory.ts` + `electron/agent.ts`.

**Left to do.**

- Promote/demote: let a memory be shared or kept private.
- Dedupe and conflict resolution when two bots publish the same key.

## 8. Bot-to-bot handoffs

**Today.** Inline handoff works (`collab.ts`): an `@Name` mention fires the target in the same run. The new
`HandoffStore` makes a handoff durable with a lifecycle (`queued → accepted → done | failed`) so it can outlive
the run and, later, the process — a hosted receiver can pick it up. Queuing a handoff now **auto-dispatches** it
(`main.ts`: `dispatchHandoff`) to an idle target when `settings.allowBotHandoff` is on, marks it `done` when the
target goes idle, and drains the next queued one. `reciprocalInFlight()` (pure, tested) blocks an A→B→A cycle by
failing the second handoff with a note.

**Files.** `electron/cloud/handoff.ts`, `electron/collab.ts`, `electron/main.ts`.

**Left to do.**

- A max-depth guard for chains the reciprocal check cannot see (handoffs nested via `@Name` rather than queued).
- Cancel/retry, and a UI showing the fleet's in-flight handoffs.
- Point the store at the hosted bus when `kind === 'hosted'`.

---

## IPC surface

Every capability is reachable through the typed bridge. Adding more means touching the four files listed in
[DEVELOPMENT.md](DEVELOPMENT.md#adding-an-ipc-method); the demo fallback in `renderer/src/demoApi.ts` already
implements all of these so the UI runs in a browser tab.

| Channel | Returns |
| --- | --- |
| `rs:cloudStatus` | `CloudRuntimeStatus` |
| `rs:listComputers` / `rs:ensureComputer` / `rs:stopComputer` | `CloudComputer[]` / `CloudComputer` |
| `rs:listDevices` / `rs:registerDevice` / `rs:removeDevice` | `DeviceClient[]` / `DeviceClient` / `{ ok }` |
| `rs:listRecordings` / `rs:startRecording` / `rs:captureRecording` / `rs:stopRecording` | `Recording[]` / `Recording` |
| `rs:saveRecordingAsRoutine` | `Routine` |
| `rs:listHandoffs` / `rs:queueHandoff` | `Handoff[]` / `Handoff` |
| `rs:listFederated` / `rs:publishFact` / `rs:forgetFact` | `FederatedFact[]` / `FederatedFact` / `{ ok }` |

Push events (`rs:event`): `cloud`, `computers`, `devices`, `recordings`, `handoffs`, `federated`.

## Data files

| File | Store | Contents |
| --- | --- | --- |
| `workspace/computers.json` | `cloud/computer.ts` | Per-bot computer records (state, credential labels). |
| `devices.json` | `cloud/devices.ts` | Attached clients. |
| `recordings.json` | `cloud/recording.ts` | Teach-by-showing recordings and their steps. |
| `handoffs.json` | `cloud/handoff.ts` | Bot-to-bot handoff queue. |
| `federated.json` | `cloud/federation.ts` | Shared cross-bot facts. |

## Tests

`test/cloud.test.ts` covers the runtime factory and stubs, the computer/device/recording/handoff/federation
stores, and the pure helpers (`draftRoutineFromRecording`, `captureRecordingSteps`, `reciprocalInFlight`,
`factVisibleTo`). `test/agent.test.ts` covers the agent wiring: learned facts get published, and other bots'
facts reach the system prompt. Run `npm test`.

## Ground rules

- **The local-first promise holds until a hosted runtime is chosen.** Do not make the local path depend on a
  network service.
- **Secrets never cross the bridge.** Credentials are referenced, never returned — follow the `credentialCount`
  pattern in `computer.ts`.
- **Validate at the boundary.** IPC handlers in `main.ts` are the trust edge; throw a plain `Error` with a
  user-readable message, as the existing handlers do.
- **Keep the pure logic pure.** Prompt composition and visibility rules belong in exported functions so they
  stay testable without a store.

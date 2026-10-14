# Contributing to Red Sky

Thanks for wanting to help. Red Sky is a small, opinionated codebase — an Electron shell around a locally
spawned OpenCode server — and it is very approachable: no monorepo, no build system to learn, no database
server to run (just one embedded SQLite file, created automatically), and no generated code.

This document covers how to get set up, how to propose changes, and what a reviewable pull request looks like.
By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

| I want to… | Start here |
| --- | --- |
| Report a bug | [Open a bug report](https://github.com/0xMudit/redsky-agents/issues/new?template=bug_report.yml) |
| Suggest a feature | [Open a feature request](https://github.com/0xMudit/redsky-agents/issues/new?template=feature_request.yml) |
| Fix something small | [`good first issue`](https://github.com/0xMudit/redsky-agents/labels/good%20first%20issue) |
| Pick up something meaty | The [roadmap](README.md#roadmap) — especially the missing test harness |
| Improve the docs | Typos, unclear steps, and gaps in `docs/` are all fair game |
| Report a vulnerability | **Privately**, per [SECURITY.md](SECURITY.md) — never in a public issue |

## Setup

```bash
git clone https://github.com/<you>/redsky-agents.git
cd redsky-agents
npm install
npm start
```

You need **Node.js 20+** and the **OpenCode CLI on your `PATH`** (see [Requirements](README.md#requirements)).
Full detail — build pipeline, conventions, debugging, and the recipe for adding an IPC method — is in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Read it before your first code change; it is short and it will
save you a review round-trip.

## Before you open a pull request

Run both of these, and make sure they pass:

```bash
npm run typecheck
npm run build
npm test
```

That is exactly what CI runs, on Linux, Windows, and macOS. A red CI run will not be reviewed.

## Workflow

1. **Discuss large changes first.** Open an issue before writing a big feature — a new store, a change to the
   event contract, a new dependency, or anything touching the sandbox. It is much cheaper to agree on an
   approach before the code exists.
2. **Branch off `main`.** Name it for the change: `feat/renderer-dev-server`, `fix/permission-double-fire`,
   `docs/architecture-notes`.
3. **Keep one concern per branch.** A refactor and a behavior change in the same PR cannot be reviewed
   carefully, and will be asked to split.
4. **Commit in the house style.** Imperative, capitalized subject, no prefix — matching the existing history:

   ```
   Add renderer dev server with hot reload
   Fix permission card disappearing on reconnect
   Document the attach-mode workflow
   ```

   Explain *why* in the body when the subject does not carry it. Small, meaningful commits are preferred over
   one large one. If your tooling adds a co-author trailer, leave it in.
5. **Open the PR** and fill in the template. Link the issue it closes (`Closes #123`).

## What makes a PR reviewable

- **It is small.** A focused diff gets reviewed the same day; a 2,000-line one sits.
- **It passes the checks above**, and you have said whether you ran the app.
- **UI changes include a screenshot or a short screen recording.** The app is visual; describe the before and
  after in images where you can.
- **It does not reformat unrelated code.** There is no autoformatter in this repo by design — see
  [Conventions](docs/DEVELOPMENT.md#conventions) — so keep diffs formatting-neutral.
- **It respects the trust boundaries.** The renderer gets capabilities only through the `preload.ts`
  allow-list. New IPC handlers validate their arguments in the main process. File and shell work stays inside
  the workspace. If your change widens any of those boundaries, say so explicitly in the PR description.
- **It updates the docs it invalidates.** A new environment variable or settings key belongs in
  `docs/CONFIGURATION.md`; a new module belongs in the tables in `docs/ARCHITECTURE.md`.
- **It adds a test when it can.** Add a file at `test/<name>.test.ts` and the runner picks it up (see
  [Testing](docs/DEVELOPMENT.md#testing)). Pure logic — parsing, policy matching, diffs — is where tests pay
  off most, and fixing a bug should come with the test that would have caught it.

## Review process

- A maintainer will respond to every PR. Expect a first look within a few days; this is a side project, so
  please be patient and feel free to ping the thread after a week.
- Reviews aim to be specific and actionable. If a comment is ambiguous, ask rather than guess.
- Approval means "this is good to land", not "this is perfect". Follow-up work belongs in a new issue.
- The maintainer may push small fixups directly to your branch (formatting, typos, a missing doc line). Larger
  changes will always be requested from you instead.

## Dependencies

New runtime dependencies need a justification in the PR description — this project ships a desktop app and
deliberately keeps its dependency list short (React, `marked`, and `dompurify`). Prefer the standard library
and platform APIs. Dev dependencies that unlock testing are an easy yes.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).

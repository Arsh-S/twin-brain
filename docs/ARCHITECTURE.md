# Architecture

How twin is put together, end to end. This describes the framework only; no personal data lives in
this repo.

## The three layers

twin keeps a hard separation between what you write and what the agent writes:

- **`raw-sources/`** is immutable input. You (and the capture hooks) drop notes, clips, and session
  transcripts here. The agent only ever reads these or moves processed ones into
  `raw-sources/processed/`. It is the source of truth.
  - `inbox/` quick captures, `chats/` captured sessions, `projects/<name>/` per-project dumps.
- **`wiki/`** is agent-owned, compiled knowledge: `people/ concepts/ projects/ personal/ learning/`,
  plus `maps/` (Maps of Content) and `index.md` (a flat catalog). You read it; the agent writes it.
- **`generated/`** holds one-off AI outputs (briefings, drafts), dated `YYYY-MM-DD-<topic>.md`. It is
  not curated knowledge, so it stays out of `wiki/`.

`log.md` is an append-only timeline of every operation. `config/` holds `twin.config.json` and the
`projects.json` capture-policy registry.

## The page pattern

Every wiki page is two things at once:

1. A **summary** section: the current best understanding, rewritten as it evolves.
2. A **timeline** of dated, append-only entries: `- [YYYY-MM-DD] fact learned (source: file)`.

This lets the agent revise the synthesis without losing how it was learned, and makes history
auditable. Pages carry frontmatter (`domain`, `tags`, `created`, `updated`) so the tidy pass and the
MOCs can sort them automatically.

## The engine

The engine is the `claude` CLI you are already logged into, so twin runs on your Claude Code
subscription with **no API keys and no metered billing**. The CLI never talks to an API directly.

Each reasoning operation is a headless agent run: `bin/twin` reads a prompt from `skills/<op>.md`,
appends a short "this run" instruction, and calls
`claude -p <prompt> --allowedTools <tools> --permission-mode acceptEdits` from inside the vault.
The tool allow-list is scoped per operation (for example, research adds `WebSearch`/`WebFetch`,
agenda adds the calendar MCP tools). Mechanical work (`tidy`) runs on a cheap model
(`TWIN_CHEAP_MODEL`, default haiku); reasoning runs on the smart model.

## CLI surface

`bin/twin` is a single bash script. Notable pieces:

- **capture / clip / ingest / ask / search** the core loop.
- **lint / tidy / research** the maintenance passes.
- **remind / reminders / calendar / agenda** the Life-OS layer.
- **track / private / check / projects** the per-project capture policy, stored in
  `config/projects.json` via small python helpers (no `jq` dependency).
- **sync** secret-scans, commits, and pushes.
- **nightly / weekly** the scheduled bundles.
- **doctor** a health check (deps, git remote, launchd jobs, hooks, EventKit permission).
- **app** launches the web UI.

## Life-OS via EventKit

On macOS, twin talks to Apple **EventKit** directly through small Swift helpers in `bin/`, so it
reaches every account with no per-account OAuth and never launches the Calendar or Reminders apps:

- `twin-cal.swift` reads events as human-readable text.
- `twin-cal-json.swift` reads events as structured JSON (for the web app and agenda).
- `twin-rem.swift` is full Apple Reminders CRUD: add, complete, edit, delete, plus list management
  (list, create, move between lists, rename, delete with reassignment).

Calendar writes are optional and go through a calendar MCP to a single calendar you designate in
`twin.config.json`.

## The web app

`app/` is a React + TypeScript front-end (Vite). Because a browser cannot run EventKit, Swift, or
`claude`, the **Vite dev server doubles as the backend**: `app/server/twin-api.mjs` is registered as
middleware and handles every `/api/*` request by either shelling out to the `twin` CLI / Swift
helpers (`execFile`) or reading the vault files. The React app fetches real data through a typed
client (`src/api.ts`). There is no production backend; you run it with `twin app` (or `npm run dev`).

Representative endpoints:

| Endpoint | Backed by |
|---|---|
| `GET /api/status`, `/api/doctor`, `/api/search` | the `twin` CLI |
| `GET /api/calendar`, `/api/reminders`, `POST /api/reminder` | the Swift EventKit helpers |
| `GET /api/wiki/tree`, `/api/wiki/page`, `/api/captures`, `/api/activity` | vault files |
| `GET/POST /api/profile`, `/api/registry`, `/api/config` | `profile.md` + `config/` |
| `POST /api/capture`, `/api/ask`, `/api/job` | `twin` capture / ask / maintenance jobs |

The UI has eight screens (Today, Capture, Ask, Wiki, Tasks, Calendar, Maintain, Settings) reachable
with Option + 1 to 8, with light/dark and editorial/console themes.

## Automation

Two `launchd` jobs (cron elsewhere) keep the brain current:

- **nightly**: `ingest`, then `tidy` only if `wiki/` actually changed (a `git status` delta guard),
  then `sync`. Near-zero cost on quiet days.
- **weekly**: `ingest`, `lint`, `research` (soft budget), `tidy`, `sync`.

Both are idempotent. They stamp `.state/{nightly,weekly}.lastrun` and skip if already run this
calendar day or ISO week. `launchd` fires them on schedule and again at login (`RunAtLoad`), so a run
missed because the machine was off is caught up exactly once on next login, never double-run.
`--force` overrides. `.state/` is machine-local and gitignored.

## Search

`twin search` maintains a `twin-wiki` qmd collection (created on first use, refreshed before each
query) and runs a hybrid BM25 + vector search with RRF fusion. It degrades gracefully: semantic
search, then plain keyword search, then `grep` when neither qmd nor an embedding model is present.

## Privacy model

- The vault holds your data and is meant for a **private** repo, or no remote at all. This framework
  repo holds only functionality.
- A **secret scan** (API keys, AWS keys, GitHub/Slack tokens, private keys, Google API keys) runs
  before every `twin sync` and aborts the push on a hit. It scans only files git would commit, so
  gitignored transcripts do not cause false positives.
- The per-project registry marks each project `tracked` (auto-capture), `private` (never captured),
  or `unknown` (ask once). The SessionEnd capture hook respects this and skips twin's own directory.

## Repo layout

```
bin/        twin CLI + Swift EventKit helpers (twin-cal, twin-cal-json, twin-rem)
skills/     prompts for ingest / ask / lint / tidy / research / agenda
templates/  CLAUDE.md, twin.config.json, profile.md, launchd plists, the global snippet
hooks/      SessionStart (recall) + SessionEnd (capture) scripts
app/        the local web UI + its dev-server API bridge
docs/        the system diagram + this document
install.sh  scaffolds a vault, wires the CLI/hooks/jobs, copies bin/ + app/ in
```

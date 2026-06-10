# twin — desktop app

A real desktop front-end for **twin** (the personal second brain + life OS in this repo). Built
from a [Claude Design](https://claude.ai/design) handoff and wired to the live `twin` CLI + wiki —
no mock data.

## How it works

The browser can't run EventKit/Swift/claude itself, so the **Vite dev server doubles as a local API**
(`app/server/twin-api.mjs`): every `/api/*` request shells out to the `twin` CLI or reads the wiki
files, and the React app fetches real data. This means you run it with `npm run dev` — the dev
server *is* the backend (the engine is local anyway).

```bash
cd app
npm install
npm run dev        # http://localhost:5179  (this is the app — keep it running)
npm run typecheck
```

`npm run build` produces a static bundle, but the `/api` bridge only exists under `npm run dev`, so
**use `npm run dev`** to actually run twin.

## What's live (real data, no mocks)

- **Today** — real Apple Calendar events for today, open Apple Reminders, your `profile.md`
  priorities (edit → saved back to `profile.md` on blur), project pulse from `wiki/projects/`,
  and live `twin status` counts.
- **Capture** — the box + drag-and-drop + "File ↑" write real `raw-sources/inbox/*.md` via
  `twin capture`; the inbox list reads those files.
- **Ask** — runs `twin ask` (headless claude on your Max plan) and shows the cited answer.
- **Wiki** — real `wiki/` tree + page reader (markdown parsed to blocks, `[[wikilinks]]` clickable).
- **Tasks** — real Apple Reminders: add / complete / **edit** (click text or ✎) / **delete** (🗑),
  all via EventKit.
- **Calendar** — all Apple accounts via EventKit (7-day strip + grouped agenda).
- **Maintain** — runs the real `twin` jobs: ingest / tidy / lint / research / sync / agenda.
- **Settings** — live `twin doctor`, `config/twin.config.json`, and the `config/projects.json`
  capture-policy registry (writes back).

Heavy jobs (ask, ingest, lint, research, agenda) spawn the local Max engine and take seconds to
minutes; the Jobs rail shows them running. **Sync** commits and pushes to your vault's git remote.

## Themes & shortcuts

- Light / dark toggle (respects OS scheme on first load, persists to `localStorage`).
- Editorial (serif) ↔ Console (mono) direction toggle.
- **⌥ (Option) 1–8** jump between screens.
- Mobile (<700px): sidebar collapses into a hamburger drawer.

## Structure

```
app/
  server/twin-api.mjs   the dev-server bridge (CLI + files → JSON)
  bin uses ../bin/twin, ../bin/twin-rem.swift, ../bin/twin-cal-json.swift
  src/
    App.tsx     state, handlers, all 8 screens, the view-model builder
    api.ts      typed client for /api/*
    theme.ts    light/dark + direction palettes → CSS custom properties
    ui.tsx      Spinner + the [[wikilink]]/**bold**/_italic_ tokenizer
    css.ts      css() helper — inline style strings → React style objects
```

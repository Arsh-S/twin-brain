# twin - schema & operating rules

**twin** is a personal second brain: a persistent, interlinked markdown wiki that an LLM builds
and maintains. The engine is Claude Code (runs on your Claude subscription, no API tokens, no
external database).

> Obsidian is the IDE. The LLM is the programmer. The wiki is the codebase.
> You (the agent) write the wiki. The user curates sources and asks questions.

## Architecture (three layers)

- `raw-sources/` - immutable inputs. You READ these, never edit them (you may MOVE processed
  ones into `raw-sources/processed/`). Source of truth.
  - `inbox/` quick captures, `chats/` captured sessions, `projects/<name>/` per-project dumps.
- `wiki/` - you OWN this entirely. Compiled, interlinked knowledge. The user reads, you write.
  - `people/ concepts/ projects/ personal/ learning/`, `maps/` (MOCs), plus `index.md`.
- `CLAUDE.md` (this file) + `skills/` - the conventions and workflows.

Two special files:
- `wiki/index.md` - catalog of every page, by category, each with a one-line summary. Read it
  FIRST when answering. Keep it current on every ingest/tidy.
- `log.md` - append-only timeline. Entry format: `## [YYYY-MM-DD HH:MM:SS] <op> | <detail>`.

## The page pattern: compiled truth + timeline

Every wiki page has:
1. A short **summary** section = current best understanding (rewrite as it evolves).
2. A **timeline** of dated, append-only entries: `- [YYYY-MM-DD] fact learned (source: file)`.

This keeps history auditable and lets you revise the synthesis without losing how it was learned.

## Operations (see `skills/`)

- **ingest** - read new sources, integrate into the wiki (triage/dedupe/frontmatter; smart model).
- **ask** - answer from the wiki with citations; never fabricate; flag gaps.
- **clip URL** - pull a web page as clean markdown (defuddle) into the inbox.
- **tidy** - cheap mechanical pass: frontmatter, index, link fixes, sort pages into MOCs.
- **lint** - deep pass: reconcile contradictions (bi-temporal), health audit, flag destructive items.
- **research [N]** - capped web gap-fill: fills at most N flagged gaps, cited.

### Cadence & token budget
- **nightly**: ingest + tidy (only if something changed) + sync. Near-zero cost on quiet days.
- **weekly**: ingest + lint + research (capped) + tidy + sync.
- Mechanical work runs on the cheap model; reasoning on the smart model. Prefer touching deltas
  (git status/diff) over re-reading the whole wiki.

## Hard rules

- Never invent facts. Record only what sources support. Flag contradictions, don't silently pick.
- Never write secrets/credentials/keys into the wiki. Redact them.
- Prefer integrating into existing pages over creating new ones. Keep pages small and focused.
- Wire the graph: add `[[wikilinks]]` to related pages whenever you touch a page.
- Be conservative with deletions and big rewrites. Git is the safety net, but flag, don't destroy.
- Filenames: kebab-case, `.md`.

## Domains (what goes where)

- `projects/` - what the user is building.
- `learning/` - articles, videos, concepts being studied; durable knowledge.
- `personal/` - goals, decisions, preferences, a picture of the user over time.
- `concepts/` - reusable ideas/terms referenced across domains.
- `people/` - people and orgs that recur.
- `maps/` - Maps of Content (navigation hubs), maintained by tidy.

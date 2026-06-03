# twin

**A second brain that builds itself.** twin turns Claude Code into a disciplined wiki-maintainer:
you feed it sources and work normally, and it compiles a persistent, interlinked Markdown knowledge
base you fully own. No database, no API keys, no vendor lock-in. Runs on your Claude Code
subscription.

Based on Andrej Karpathy's [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
pattern, and uses [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) for Obsidian
formats.

![twin system diagram](docs/twin-system.png)

## Why

Most "AI + notes" setups are RAG: they re-derive answers from raw chunks every query, and nothing
compounds. twin is different. The LLM **compiles** knowledge once and keeps it current, integrating
each new source into existing pages, wiring `[[wikilinks]]`, and flagging contradictions. The wiki
is a compounding artifact. Open it in [Obsidian](https://obsidian.md) and browse the graph.

## Features

- **Self-building wiki** — drop sources in, the agent files, links, and summarizes them.
- **Auto-capture from your work** — a SessionEnd hook backs up Claude Code sessions; a SessionStart
  hook injects relevant context into new ones. Per-project opt-in (private projects stay private).
- **Compiled-truth + timeline** pages — current understanding plus a dated, append-only history.
- **Maps of Content** — pages auto-sort into navigation hubs that scale to thousands of notes.
- **Token-budgeted automation** — cheap nightly tidy (skips when nothing changed), deeper weekly
  pass; mechanical work runs on a cheap model, reasoning on the smart one.
- **Web research** — `twin clip <url>` (clean markdown via defuddle) and capped web gap-filling.
- **Yours and safe** — plain Markdown in a git repo. Git history is the undo. Secret-scan before
  every push.

## Install

Requires [Claude Code](https://claude.com/product/claude-code), `git`, and `python3`.

```bash
git clone https://github.com/<you>/twin.git
cd twin
./install.sh --with-skills        # add --dir PATH to choose where the brain lives (default ~/twin)
```

This creates your vault (default `~/twin`), puts `twin` on your PATH, installs the Claude Code
hooks, and schedules the nightly/weekly jobs (macOS). Your knowledge lives in the vault, separate
from this framework repo.

## Usage

```bash
twin capture "a thought"               # drop into the inbox
twin clip https://example.com/article  # web page -> clean markdown
twin ingest                            # compile inbox into the wiki
twin ask "what do I know about X?"     # cited answer
twin tidy                              # cheap clean + sort into MOCs
twin lint                              # deep reconcile + health audit
twin research 3                        # fill up to 3 web-research gaps
twin remind "call the dentist"         # create an Apple Reminder (macOS)
twin agenda                            # briefing: calendar + reminders + priorities -> generated/
twin status
```

In any repo, Claude Code will offer (once) to track that project in twin; tracked projects get
captured automatically, private ones never.

## How it works

```
capture ──▶ raw-sources/ ──▶ ingest (Claude) ──▶ wiki/ ──▶ ask / SessionStart recall
   ▲              (immutable)        (compiles)     (the brain)            │
   └──────────────────── compounding loop ─────────────────────────────────┘
                 nightly: ingest + tidy + sync   ·   weekly: + lint + research
```

- `raw-sources/` — immutable inputs (you write; the agent only reads/moves).
- `wiki/` — agent-owned compiled knowledge (`projects/ learning/ personal/ concepts/ people/ maps/`).
- `skills/` — the prompts that define ingest / ask / lint / tidy / research behavior.
- `CLAUDE.md` — the schema that makes the agent a disciplined maintainer.

## Token budget

twin is built to stay cheap: the nightly job spends ~0 tokens on days nothing changed (delta guard),
mechanical passes run on the cheap model, web research is hard-capped (default 3/week), and agents
work on git deltas instead of re-reading the whole vault. Tune with `TWIN_CHEAP_MODEL` and
`TWIN_RESEARCH_CAP`.

## Life-OS layer (optional, macOS)

twin can act on the world, not just remember it:
- `twin remind "..."` writes to **Apple Reminders** (local, via `osascript` — grant Reminders
  access on first run).
- `twin agenda` builds a daily briefing from your **calendar** (any calendar MCP you've configured,
  e.g. [google-calendar-mcp](https://github.com/nspady/google-calendar-mcp)) + open reminders +
  your `profile.md` priorities, saved to `generated/`.
- `ingest` turns clear action items in your notes into reminders automatically.

These are optional. Calendar features need a calendar MCP configured; reminders need macOS.

## Privacy

The vault holds **your** data; keep it in a **private** repo (or no remote). This framework repo
contains only functionality, no personal content.

## License

MIT — see [LICENSE](LICENSE).

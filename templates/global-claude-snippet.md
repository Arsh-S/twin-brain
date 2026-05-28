<!-- twin: append this block to your ~/.claude/CLAUDE.md so every Claude Code session uses twin -->

## twin - my second brain

I run a personal second brain called **twin** at `~/twin`, driven by the `twin` CLI. It captures
what I learn and build so any future session has continuity. It runs on my Claude subscription via
the `twin` command (no API tokens).

**Consult it.** Before substantial work, if the task plausibly relates to something I'd know, run
`twin ask "<question>"` (or `twin search "<term>"`) to pull relevant context from the wiki.

**Feed it (capture), with these rules:**
- **Tracked vs private projects.** When working in a project directory, check status with
  `twin check`.
  - `tracked` -> capture important decisions/learnings as they happen via
    `twin capture "<fact>" --project <name>`.
  - `private` -> never capture from it. Stay silent.
  - `unknown` AND something genuinely important comes up -> ask once: "Track this project in twin?"
    Then run `twin track` (yes) or `twin private` (no). Remember the answer; don't ask again.
- **Non-project chats** (running from `~`, `~/Documents`, etc.): still capture genuinely important
  things via `twin capture "<fact>"`. Skip trivia and noise.
- **What counts as important:** decisions, architecture choices, gotchas/fixes worth remembering,
  goals, preferences, durable facts. NOT routine edits, transient debugging chatter, or secrets.
- **During and at the end.** Capture important things inline; a SessionEnd hook also backs up the
  transcript as a safety net.
- **Never** put secrets, API keys, tokens, or credentials into twin.

**Tools.** Save a web page with `twin clip <url>` (defuddle). A SessionStart hook injects a compact
twin snapshot (index + recent activity) at the start of each session; use it.

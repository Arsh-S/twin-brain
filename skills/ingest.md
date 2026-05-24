# twin skill: INGEST

You are the maintainer of "twin", a personal second-brain wiki for you. You are running
headless inside `~/twin`. Read the operating rules in `CLAUDE.md` before acting.

## Your job for this run

Turn raw, unprocessed sources into compiled, interlinked wiki knowledge.

For each unprocessed source (in `raw-sources/inbox/`, `raw-sources/chats/`, or the path given):

1. **Read** the source fully (and any referenced transcript `.jsonl`).
2. **Decide its domain**: `projects/`, `learning/`, `personal/`, `concepts/`, or `people/`.
3. **Extract** the durable, important facts. Ignore transient chatter, secrets, and noise.
4. **Integrate**, do not just append:
   - Update the relevant existing wiki page(s) using the "compiled truth + timeline" pattern:
     a short summary section reflecting current understanding, then a dated timeline entry
     `- [YYYY-MM-DD] <what was learned> (source: <file>)`.
   - Create a new page only when no good home exists. Use kebab-case filenames.
   - Add `[[wikilinks]]` to every related page you touch. Wire the graph.
   - Flag contradictions with existing claims inline as `> [!warning] contradicts ...`.
5. **Update `wiki/index.md`**: ensure every page is listed with a one-line summary under its category.
6. **Append to `log.md`**: `## [YYYY-MM-DD HH:MM:SS] ingest | <source title> -> touched N pages`.
7. **Retire the source**: move processed files from `raw-sources/inbox/` (and `raw-sources/chats/`)
   into `raw-sources/processed/` (create it if needed) so they are not re-ingested. When you move a
   file, set its frontmatter `status: processed` (the one allowed edit). Otherwise raw sources are
   immutable: never change their content.

## Be intelligent (save tokens, raise quality)
- **Triage first:** skim each source and skip ones with no durable value (pure chatter, dead ends,
  duplicates of what you already know). Log skips briefly; don't write pages for noise.
- **Dedupe:** before creating a page, check the index for an existing page on the topic and extend
  it instead. Never create a near-duplicate.
- **Frontmatter:** give every page you create/update `domain`, `tags`, `created`, `updated` so the
  tidy pass and MOCs can sort it automatically.
- **Batch:** process all the listed sources in this one run; don't ask for another pass unless new
  files appear mid-run.

## Rules
- One source can touch 5-15 wiki pages. That is expected and good.
- Never invent facts. Only record what the sources support.
- Never write secrets/credentials into the wiki. Redact them.
- Keep pages focused and small; split a page that grows to cover too much.
- At the end, print a short summary: which sources you processed and which pages you touched.

# twin skill: ASK

You are answering a question using ONLY your twin wiki (`~/twin/wiki/`). You are read-mostly.
Read `CLAUDE.md` for conventions.

## Procedure
1. Read `wiki/index.md` first to locate relevant pages.
2. Use `twin search`, grep, or follow `[[wikilinks]]` to pull the right pages.
3. Read those pages fully.
4. Answer concisely and accurately.
5. If the wiki does not contain the answer, say so plainly and note the gap. Do NOT fabricate.

## Output format (terminal — make citations clickable)
This output is read in a terminal, NOT in a markdown renderer. So:
- Do not use `[text](link)` markdown links — terminals show them as raw text.
- Lead with the answer in plain prose. Keep it tight.
- End with a `Sources:` block: each cited file on its own line as an ABSOLUTE path so the user can
  Cmd/Ctrl-click to open it. Get the base path with `pwd` (it is the twin dir) and prefix each
  file, e.g.:

  Sources:
    ~/twin/wiki/projects/twin.md
    ~/twin/wiki/concepts/llm-wiki.md

  One path per line, indented two spaces, nothing after the path on the line (so the whole token is
  clickable). If you reference a specific section, mention it in the prose, not on the path line.
- If there were zero matches, print `Sources: (none — gap in the wiki)`.

## Optional: save the output
Two homes, pick the right one:
- **Durable knowledge** (a synthesis, a discovered connection, a fact worth recalling later) ->
  offer to save as a `wiki/` page so it compounds and joins the graph.
- **One-off artifact** (a drafted email, a comparison table, a briefing you asked for once) ->
  save to `generated/<YYYY-MM-DD>-<topic>.md`, NOT the wiki. These are outputs, not knowledge.
Only save when it clearly has value; otherwise just answer.

Keep it tight. Lead with the answer, then supporting detail, then citations.

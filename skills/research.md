# twin skill: RESEARCH (capped web gap-fill, runs weekly on the smart model)

You fill knowledge gaps in the wiki using the web. You have WebSearch, WebFetch, and can shell out
to `twin clip <url>`. Read `CLAUDE.md` for conventions. **You are strictly token-budgeted.**

## Hard cap
Fill AT MOST N gaps this run (N is given in the run instructions, default 3). Stop at the cap even
if more gaps exist. Quality over quantity.

## Procedure
1. Read `reports/lint-report.md` (the "Needs your review" and "Health" sections) and `wiki/index.md`
   to find flagged gaps: data gaps, "concept mentioned but no page", thin/stale domains, unresolved
   `[[links]]`. Also consider gaps you can infer from the most-linked pages.
2. Rank gaps by value to you (your active projects/interests first). Pick the top N.
3. For each chosen gap:
   - Gather sources: `twin clip <url>` for a known good page, or WebSearch + WebFetch/defuddle.
   - Write or extend the wiki page using compiled-truth + dated timeline. **Cite every external
     fact with its source URL.** Mark these as web-sourced (frontmatter `origin: web-research`).
   - Wire `[[wikilinks]]` and update `index.md` + the relevant MOC.
4. Append to `log.md`: one line per gap filled, with the URL(s) used.

## Rules
- Never exceed the cap. Never fabricate; if the web doesn't answer it, log the gap as still-open.
- Never write secrets. Prefer primary/official sources. Keep new pages focused.
- If there are no worthwhile gaps, do nothing and say so (spend nothing).

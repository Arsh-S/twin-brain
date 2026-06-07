# twin skill: RESEARCH (soft-budgeted web gap-fill, runs weekly on the smart model)

You fill knowledge gaps in the wiki using the web. You have WebSearch, WebFetch, and can shell out
to `twin clip <url>`. Read `CLAUDE.md` for conventions. **You are token-budgeted, but the budget is
a soft target, not a wall.**

## Soft budget
N (given in the run instructions, default 3) is your **target** number of gaps, not a hard limit.
- Aim for N. Quality over quantity always.
- You MAY go over N when the extra gaps are clearly high-value, e.g. tightly related to ones you're
  already filling (same page/source, marginal cost), or tied to one of the user's active priorities
  and genuinely worth the quota. Exceeding should be a deliberate, justified choice, not drift.
- Don't run away. Stop once marginal value drops off. As a sanity ceiling, going past ~2x N should
  be rare and only for an obviously worthwhile cluster; never fill low-value gaps just to use budget.
- If you exceed N, say so in the log and why (e.g. "filled 5 (target 3): 3 priority + 2 same-source").

## Procedure
1. Read `reports/lint-report.md` (the "Needs your review" and "Health" sections) and `wiki/index.md`
   to find flagged gaps: data gaps, "concept mentioned but no page", thin/stale domains, unresolved
   `[[links]]`. Also consider gaps you can infer from the most-linked pages.
2. Rank gaps by value to the user (their active projects/interests first). Pick the top N.
3. For each chosen gap:
   - Gather sources: `twin clip <url>` for a known good page, or WebSearch + WebFetch/defuddle.
   - Write or extend the wiki page using compiled-truth + dated timeline. **Cite every external
     fact with its source URL.** Mark these as web-sourced (frontmatter `origin: web-research`).
   - Wire `[[wikilinks]]` and update `index.md` + the relevant MOC.
4. Append to `log.md`: one line per gap filled, with the URL(s) used.

## Rules
- Treat N as a soft target (see above), not a wall. Never fabricate; if the web doesn't answer it, log the gap as still-open.
- Never write secrets. Prefer primary/official sources. Keep new pages focused.
- If there are no worthwhile gaps, do nothing and say so (spend nothing).

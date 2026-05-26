# twin skill: LINT (periodic cleanup)

You are the janitor for your twin wiki (`~/twin/wiki/`). Read `CLAUDE.md` first.
Goal: keep the brain accurate, consistent, and well-connected. Runs nightly.

## Auto-fix (do these directly, they are safe)
- Repair broken `[[wikilinks]]` (renamed/missing targets).
- Add missing cross-references between clearly related pages.
- Rebuild/refresh `wiki/index.md` so every page is listed once with an accurate one-liner.
- Merge obvious exact-duplicate pages or sections (keep the richer version, link the timeline).
- Normalize frontmatter, fix formatting, fix dead headings.
- Connect orphan pages (no inbound links) to relevant hubs where the link is clearly correct.

## Flag only (do NOT change, write to the report for you to approve)
- Contradictions between pages (quote both sides).
- Stale claims a newer source has superseded.
- Suspected duplicates that are not clearly identical (propose a merge).
- Any deletion or large rewrite.
- Concepts mentioned repeatedly but lacking a dedicated page (propose creating it).
- Data gaps worth a future source or web search.

## Reconcile (run as part of lint)
Scan for the SAME fact stated differently across pages. When two claims conflict:
- If one is clearly newer (later timeline date or newer source), update the summary to the newer
  truth and keep BOTH in the timeline so the belief history is preserved (bi-temporal). Note the
  supersession: `- [YYYY-MM-DD] updated: X now Y (was Z, source: ...)`.
- If you cannot tell which is correct, do NOT pick. Flag it in the report for you.

## Health audit (run as part of lint)
Report the brain's overall shape: page count by domain, hub pages (most inbound links), orphans,
domains that look thin or stale, and 2-3 concrete suggestions (a page worth creating, a source
worth finding, a topic worth a web clip).

## Output
Write a dated report to `reports/lint-report.md` (overwrite the previous one) with sections:
"Auto-fixed", "Reconciled", "Needs your review" (flagged items with file:line), and "Health".
Append a one-line summary to `log.md`. Print the report path and a 3-bullet summary.

Never delete a wiki page on your own. Never invent facts. Git history is the safety net but be conservative.

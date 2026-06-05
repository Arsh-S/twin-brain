# twin skill: AGENDA (daily briefing — calendar + reminders + priorities)

You build a short, personalized daily briefing. Read `CLAUDE.md` for conventions. Be concise.

## Gather (in this order)
1. **Who/priorities:** read `wiki/personal/profile.md` (especially `## Priorities now`).
2. **Today's calendar:** run `twin calendar 1` via Bash (EventKit, all Apple Calendar accounts, no
   app launch). If it prints "Calendar access denied", fall back to a calendar MCP's `list-events`
   if one is configured. Each `twin calendar` line is `Title | start [calendar]`.
3. **Open reminders:** run `twin reminders` via Bash (EventKit; falls back to osascript). If it
   reports a permissions error, note that and continue.
4. **Project pulse:** skim the active-project pages named in the profile for current status.

## Produce
A briefing under ~250 words:
- **MOST IMPORTANT TODAY** — the single highest-leverage action, grounded in `Priorities now`.
- **SCHEDULE** — today's events, one line each (time + what + a one-line prep note if useful).
- **OPEN REMINDERS** — the open reminders, grouped/prioritized.
- **PROJECT PULSE** — one line per active project: status + next action.

Save to `generated/<YYYY-MM-DD>-agenda.md` (output, not knowledge — never in wiki/). Append one line
to `log.md`. Then print the briefing.

## Optional (only if clearly useful and low-risk)
- If a priority needs a calendar block, you MAY create/edit it via a calendar MCP, but only on a
  single calendar the user has designated for twin's auto-scheduling. Never write to other
  calendars. Otherwise just suggest the block in the briefing.

Never fabricate events or reminders. Report only what the tools return.

# twin skill: AGENDA (daily briefing — Google Calendar + Apple Reminders + priorities)

You build a short, personalized daily briefing. Read `CLAUDE.md` for conventions. Be concise.

## Gather (in this order)
1. **Who/priorities:** read `wiki/personal/profile.md` (especially `## Priorities now`).
2. **Today's calendar:** use the google-calendar MCP `list-events` for today (use `get-current-time`
   / `list-calendars` as needed). If the MCP is unavailable, say so and continue.
3. **Open reminders:** run via Bash:
   `osascript -e 'tell application "Reminders" to return name of (reminders whose completed is false)'`
   (If it errors with a permissions message, note that Reminders access must be granted and continue.)
4. **Project pulse:** skim the active-project pages named in the profile for current status.

## Produce
A briefing under ~250 words, in this shape:
- **MOST IMPORTANT TODAY** — the single highest-leverage action, grounded in `Priorities now`.
- **SCHEDULE** — today's events, one line each (time + what + a one-line prep note if useful).
- **OPEN REMINDERS** — the open Apple Reminders, grouped/prioritized.
- **PROJECT PULSE** — one line per active project: status + next action.

Save to `generated/<YYYY-MM-DD>-agenda.md` (this is an output, not knowledge — never in wiki/).
Append one line to `log.md`. Then print the briefing.

## Optional (only if clearly useful and low-risk)
- If a priority needs a calendar block and none exists, you MAY create one via the calendar MCP
  `create-event` — but only when it obviously helps; otherwise just suggest it in the briefing.

Never fabricate events or reminders. Report only what the tools return.

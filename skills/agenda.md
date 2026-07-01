# twin skill: AGENDA (daily briefing — calendar + reminders + priorities + triage)

You build a short, personalized daily briefing AND triage the user's day. Read `CLAUDE.md` for
conventions. Be concise. This runs automatically each morning (and on demand).

## Gather (in this order)
1. **Who/priorities:** read `wiki/personal/profile.md` (especially `## Priorities now`).
2. **Today's calendar:** run `twin calendar 1` via Bash (EventKit, all Apple Calendar accounts, no
   app launch). If it prints "Calendar access denied", fall back to a calendar MCP's `list-events`
   if one is configured. Each `twin calendar` line is `Title | start [calendar]`.
3. **Open reminders:** run `twin reminders` via Bash (EventKit; falls back to osascript). If it
   reports a permissions error, note that and continue.
4. **Project pulse:** skim the active-project pages named in the profile for current status.
5. **Physical state:** run `twin health coach` via Bash. It returns
   `{"line": "...", "signals": [...]}` computed deterministically from Apple Health
   (no fabrication — trust these numbers). If `signals` is non-empty, you will surface
   ONE coaching line (see Produce). If it's empty, say nothing about health — do not
   invent a physical-state observation.

## Triage (the "manage my day" part)
- Rank the open reminders against `## Priorities now`: what is overdue, due today, or
  highest-leverage for this week's priorities goes to the top. Note which list each belongs to.
- Decide the single highest-leverage action for today, grounded in priorities + today's schedule.
- Propose a sensible ordering for the day (fit the deep work around the fixed calendar events).
- **Suggest, never write.** You may *propose* a calendar block or a reminder change in the briefing,
  but DO NOT call any task/calendar write command or MCP to create/edit anything. The user confirms
  and acts themselves. This run is read + advise only.

## Produce
A briefing under ~250 words, in this shape:
- **MOST IMPORTANT TODAY** — the single highest-leverage action, grounded in `Priorities now`.
- **SCHEDULE** — today's events, one line each (time + what + a one-line prep note if useful).
- **OPEN REMINDERS** — the open reminders, triaged/prioritized (overdue + due-today first).
- **PROJECT PULSE** — one line per active project: status + next action.
- **PHYSICAL STATE** — include this line ONLY if `twin health coach` returned signals.
  Take the top signal's `line` and, if useful, tie it to today's schedule (e.g. fit a
  walk around a fixed block). One line, actionable, kind. Omit the section entirely when
  there are no signals. This is a *suggestion*, same as the rest — never a command.

## Write outputs (two places)
1. **Human-readable:** save the markdown briefing to `generated/<YYYY-MM-DD>-agenda.md` (an output,
   not knowledge — never in `wiki/`).
2. **App home feed:** write the structured briefing into `generated/today.json` via the helper
   (so the desktop app's Today screen shows it). Build a JSON object and pipe it in:
   ```bash
   echo '{
     "mostImportant": "<one line>",
     "schedule":      [{"time":"09:00","what":"…","prep":"…"}],
     "reminders":     [{"title":"…","list":"…","due":"…","priority":"high"}],
     "projectPulse":  [{"project":"…","status":"…","next":"…"}],
     "health":        "<the physical-state coaching line, or omit the key if no signals>"
   }' | python3 bin/twin-today.py merge-briefing
   ```
   This preserves any scout `findings` already in the file (merge, not clobber).

## Notify (one concise morning ping — optional)
If a notification script is configured (e.g. `~/.claude/scripts/telegram-notify.sh`), send ONE
message — the briefing TL;DR — via Bash:
```bash
~/.claude/scripts/telegram-notify.sh "☀️ Today: <most-important action>
<N> reminders open (<M> due today). <one-line schedule headline>.
<if health signals: 🫀 <the coaching line>>"
```
Include the 🫀 health line only when `twin health coach` returned signals; otherwise leave it out.
Keep it to a few lines. This is the single morning ping; do not send more. If no notify script is
configured, skip this step — the briefing still lands in the app and `generated/`.

Then append one line to `log.md`.

Never fabricate events or reminders. Report only what the tools return.

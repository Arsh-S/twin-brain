# twin skill: SCOUT (proactive outside-world discovery — surfaces things worth the user's time)

You work on the user's behalf without being asked: research the outside world for things genuinely
worth their time, and surface them. Read `CLAUDE.md` for conventions. You have WebSearch, WebFetch,
Bash (incl. `twin clip <url>`), and the smart model. **You are soft-budgeted: a few great finds
beat many mediocre ones. Quality over quantity, always.**

The run instruction tells you the **mode**:
- **`--deep`** (weekly): full sweep across all interest categories, looking out ~1–4 weeks.
- **`--daily`** (morning peek): light + cheap. ONLY time-sensitive items — happening today/tonight,
  or a deadline that is imminent. If nothing is urgent, surface nothing. Do not do a broad sweep.

## 1. Derive interests + locations from twin (no separate config)
Read, in this order:
1. `wiki/personal/profile.md` — the Identity block (especially the user's **locations**) and
   `## Priorities now`. Use these locations to anchor geographic finds (home city/region, any nearby
   metro the user can reach, term-time campus/city, etc.). The profile is the source of truth; if it
   has changed, follow it.
2. `wiki/index.md` + the active project pages it lists — to know what domains matter right now. These
   are the user's active priorities and project domains, i.e. your interests.

Recompute interests and locations from the wiki every run; they self-update as the wiki evolves.
Do not hardcode any place names or topics here — always read them from the wiki.

## 2. Find candidates
Use WebSearch / WebFetch (and `twin clip <url>` for a good page) to find time-relevant external
things matched to those interests and locations. Categories (not exhaustive, and events-near-home is
just one): local + nearby-metro tech meetups / talks / hackathons; conferences and CFP/registration
deadlines; relevant opportunities (grants, fellowships, launches, jobs aligned to the user's
trajectory); notable happenings near the user's locations worth showing up to. Prefer official /
primary sources.

## 3. Score and filter — the bar is high
For each candidate, judge **value × timeliness × proximity** and assign a `score` from 0 to 1:
- value: how well it matches the user's active priorities/interests (a priority-aligned item
  outranks a merely on-topic one).
- timeliness: is it actionable soon (upcoming, not past; deadline approaching)?
- proximity: in/near one of the user's locations, or fully online. Anything requiring travel they
  can't make is low.
Keep only items you'd genuinely tell a busy friend about. Drop the rest. Better to surface 0–3 great
items than 10 okay ones. NEVER invent an event, date, or link — every finding must come from a real
source you fetched, and carry that source `url`.

## 4. Record + dedupe (use the helper, don't hand-roll JSON)
Build a JSON array of findings, each:
`{ "title": "", "why": "<one line: why it's worth their time>", "when": "<date/time or 'rolling'>",
   "where": "<venue/city or 'online'>", "url": "<source>", "score": 0.0, "eventDate": "YYYY-MM-DD" }`
(`eventDate` optional — used to expire the dedupe entry after the event passes.)

Then pipe it through the merge helper, which dedupes against `.state/scout-seen.json` (so nothing
repeats across runs), appends only new items to `generated/today.json`, and tells you what to push:

```bash
echo '<your findings JSON array>' | python3 bin/twin-today.py merge-findings --bar 0.7 --cap 3
```
It prints `{"new":[...newly added...], "push":[...above-bar, capped, highest score first...]}`.
For the `--daily` peek use a stricter bar, e.g. `--bar 0.8 --cap 2`.

## 5. Notify (batched, never spammy — optional)
If a notification script is configured (e.g. `~/.claude/scripts/telegram-notify.sh`) and `push` is
non-empty, send ONE message for the whole batch (not one per item):
```bash
~/.claude/scripts/telegram-notify.sh "🔭 twin found worth your time:
• <title> — <why> (<when>, <where>)
  <url>
• …"
```
Only push items in `push`. Everything in `new` still lands on the app's Today panel for pull-style
review, so below-bar items are not lost. If no notify script is configured, or `push` is empty, send
nothing — the findings still appear in the app.

## 6. Log
Append one line to `log.md`: mode, how many candidates considered, how many new surfaced, how many
pushed (and why, briefly). If you surfaced nothing, say so — spend nothing further.

## Rules
- Soft budget: aim small, stop when marginal value drops. Don't fill the feed to use quota.
- Never fabricate. Cite every finding's source URL. Dry search → surface nothing, log the gap.
- Never write to the user's tasks/calendar and never write secrets.
- Do NOT edit the wiki here (this is discovery, not ingest). Only write `generated/today.json` via
  the helper and (optionally) send a notification.

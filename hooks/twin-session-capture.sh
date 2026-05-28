#!/usr/bin/env bash
# SessionEnd hook: back up the session transcript into twin as a safety net.
# Fast, no LLM. Skips private projects and trivial sessions. Nightly ingest does the real work.
set -euo pipefail

INPUT="$(cat)"
read -r TRANSCRIPT CWD < <(python3 - <<PY
import json,sys
try:
    d=json.loads('''$INPUT''')
except Exception:
    d={}
print(d.get("transcript_path",""), d.get("cwd",""))
PY
)

[ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ] || exit 0

# don't capture twin's own internal agent runs (avoid feedback loop)
case "$CWD" in
  "$HOME/twin"|"$HOME/twin/"*) exit 0;;
esac

# respect private projects
if command -v twin >/dev/null 2>&1; then
  status="$(twin check "$CWD" 2>/dev/null || echo unknown)"
  [ "$status" = "private" ] && exit 0
fi

# skip trivial sessions (fewer than 12 transcript lines ~ a couple exchanges)
lines="$(wc -l < "$TRANSCRIPT" 2>/dev/null || echo 0)"
[ "${lines:-0}" -lt 12 ] && exit 0

twin chat "$TRANSCRIPT" "$CWD" >/dev/null 2>&1 || true
exit 0

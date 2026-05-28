#!/usr/bin/env bash
# SessionStart hook: inject a compact twin brain snapshot so sessions start with continuity.
# Lightweight (no LLM): index catalog + recent activity + how to query deeper.
set -euo pipefail

INPUT="$(cat 2>/dev/null || true)"
CWD="$(python3 - <<PY 2>/dev/null || true
import json
try: print(json.loads('''$INPUT''').get("cwd",""))
except Exception: print("")
PY
)"

TWIN="$HOME/twin"
[ -d "$TWIN/wiki" ] || exit 0

# don't inject into twin's own internal agent runs
case "$CWD" in "$TWIN"|"$TWIN/"*) exit 0;; esac

# respect private projects
if command -v twin >/dev/null 2>&1 && [ -n "$CWD" ]; then
  [ "$(twin check "$CWD" 2>/dev/null || echo unknown)" = "private" ] && exit 0
fi

pages="$(find "$TWIN/wiki" -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
[ "${pages:-0}" -le 1 ] && exit 0   # nothing useful yet

echo "## twin brain (your second brain @ ~/twin)"
echo
echo "$pages wiki pages available. Catalog (read \`~/twin/wiki/index.md\` or run \`twin ask \"...\"\` for detail):"
echo
sed -n '/^## /,$p' "$TWIN/wiki/index.md" 2>/dev/null | grep -E '^(## |- )' | head -40
echo
echo "Recent twin activity:"
grep "^## \[" "$TWIN/log.md" 2>/dev/null | tail -3 | sed 's/^## //'
echo
echo "Consult twin with \`twin ask\`/\`twin search\`; capture important decisions with \`twin capture\` (see ~/.claude/CLAUDE.md twin rules)."
exit 0

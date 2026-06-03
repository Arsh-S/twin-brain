#!/usr/bin/env bash
# twin installer - sets up a personal second-brain vault + the twin CLI + Claude Code hooks.
# Usage:
#   ./install.sh [--dir PATH] [--no-launchd] [--with-skills]
#     --dir PATH      where your brain lives (default: ~/twin)
#     --no-launchd    skip macOS scheduled jobs (nightly/weekly)
#     --with-skills   also install kepano/obsidian-skills + the defuddle CLI
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TWIN_DIR="$HOME/twin"
DO_LAUNCHD=1
WITH_SKILLS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) TWIN_DIR="$2"; shift 2;;
    --no-launchd) DO_LAUNCHD=0; shift;;
    --with-skills) WITH_SKILLS=1; shift;;
    -h|--help) sed -n '2,9p' "$0"; exit 0;;
    *) echo "unknown arg: $1" >&2; exit 1;;
  esac
done

say() { printf '\033[1;34m::\033[0m %s\n' "$*"; }

# --- 1. dependencies ---
command -v claude >/dev/null 2>&1 || { echo "ERROR: Claude Code ('claude') not found. Install it first: https://claude.com/product/claude-code" >&2; exit 1; }
command -v git    >/dev/null 2>&1 || { echo "ERROR: git not found." >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 not found." >&2; exit 1; }

# --- 2. vault scaffold ---
say "Creating vault at $TWIN_DIR"
mkdir -p "$TWIN_DIR"/{bin,config,skills,reports,docs,generated} \
         "$TWIN_DIR"/raw-sources/{inbox,chats,projects,processed} \
         "$TWIN_DIR"/wiki/{people,concepts,projects,personal,learning,maps}

cp "$REPO/skills/"*.md "$TWIN_DIR/skills/"
cp "$REPO/bin/twin" "$TWIN_DIR/bin/twin"; chmod +x "$TWIN_DIR/bin/twin"
[ -f "$TWIN_DIR/CLAUDE.md" ] || cp "$REPO/templates/CLAUDE.md" "$TWIN_DIR/CLAUDE.md"
[ -f "$TWIN_DIR/config/twin.config.json" ] || cp "$REPO/templates/twin.config.json" "$TWIN_DIR/config/twin.config.json"
[ -f "$TWIN_DIR/config/projects.json" ] || echo '{}' > "$TWIN_DIR/config/projects.json"
[ -f "$TWIN_DIR/wiki/personal/profile.md" ] || cp "$REPO/templates/profile.md" "$TWIN_DIR/wiki/personal/profile.md"

if [ ! -f "$TWIN_DIR/wiki/index.md" ]; then
cat > "$TWIN_DIR/wiki/index.md" <<'EOF'
# twin wiki - index

Catalog of everything in the wiki. The agent keeps this current. Read it first when answering.

## MOCs
- [[home]]

## Projects
_(no pages yet)_

## Learning
_(no pages yet)_

## Personal
_(no pages yet)_

## Concepts
_(no pages yet)_

## People
_(no pages yet)_
EOF
fi

if [ ! -f "$TWIN_DIR/wiki/maps/home.md" ]; then
cat > "$TWIN_DIR/wiki/maps/home.md" <<'EOF'
---
domain: maps
tags: [moc, home]
---
# Home — Map of Content

Top-level hub. `twin tidy` keeps this and per-domain MOCs current.

## Domains
- [[projects-moc]]
- [[learning-moc]]
- [[personal-moc]]
- [[concepts-moc]]
- [[people-moc]]

## Also
- [[index]] — flat catalog of every page
EOF
fi

[ -f "$TWIN_DIR/log.md" ] || printf '# twin log\n\nAppend-only timeline. Format: `## [YYYY-MM-DD HH:MM:SS] <op> | <detail>`.\n\n## [bootstrap] twin created\n' > "$TWIN_DIR/log.md"

if [ ! -f "$TWIN_DIR/.gitignore" ]; then
cat > "$TWIN_DIR/.gitignore" <<'EOF'
.env
.env.*
*.pem
*.key
id_rsa*
*credentials*
*secret*
.DS_Store
.obsidian/workspace*
.trash/
raw-sources/chats/*.transcript.jsonl
EOF
fi

# --- 3. CLI on PATH ---
BINDIR=""
for d in "/usr/local/bin" "$HOME/.local/bin" "$HOME/bin"; do
  case ":$PATH:" in *":$d:"*) [ -w "$d" ] 2>/dev/null && { BINDIR="$d"; break; }; mkdir -p "$d" 2>/dev/null && [ -w "$d" ] && { BINDIR="$d"; break; };; esac
done
if [ -n "$BINDIR" ]; then
  ln -sf "$TWIN_DIR/bin/twin" "$BINDIR/twin"
  say "Linked CLI: $BINDIR/twin"
else
  say "Could not find a writable PATH dir. Add this to your shell profile:"
  echo "    export PATH=\"$TWIN_DIR/bin:\$PATH\""
fi

# --- 4. Claude Code hooks ---
mkdir -p "$HOME/.claude/scripts"
cp "$REPO/hooks/twin-session-start.sh" "$HOME/.claude/scripts/"
cp "$REPO/hooks/twin-session-capture.sh" "$HOME/.claude/scripts/"
chmod +x "$HOME/.claude/scripts/twin-session-"*.sh
say "Installed hooks to ~/.claude/scripts"

python3 - "$HOME/.claude/settings.json" <<'PY'
import json,sys,os
p=sys.argv[1]
try: s=json.load(open(p))
except Exception: s={}
hooks=s.setdefault("hooks",{})
def ensure(event,cmd):
    arr=hooks.setdefault(event,[])
    for g in arr:
        for h in g.get("hooks",[]):
            if h.get("command")==cmd: return
    arr.append({"hooks":[{"type":"command","command":cmd}]})
ensure("SessionStart","~/.claude/scripts/twin-session-start.sh")
ensure("SessionEnd","~/.claude/scripts/twin-session-capture.sh")
os.makedirs(os.path.dirname(p),exist_ok=True)
json.dump(s,open(p,"w"),indent=2)
print("   merged SessionStart + SessionEnd hooks into settings.json")
PY

# global rule
GLOBAL="$HOME/.claude/CLAUDE.md"
if ! grep -q "twin - my second brain" "$GLOBAL" 2>/dev/null; then
  { echo; cat "$REPO/templates/global-claude-snippet.md"; } >> "$GLOBAL"
  say "Appended twin rules to ~/.claude/CLAUDE.md"
fi

# --- 5. scheduled jobs (macOS launchd) ---
if [ "$DO_LAUNCHD" = "1" ] && [ "$(uname)" = "Darwin" ]; then
  LA="$HOME/Library/LaunchAgents"; mkdir -p "$LA"
  for job in nightly weekly; do
    sed "s|__HOME__|$HOME|g" "$REPO/templates/com.twin.$job.plist" > "$LA/com.twin.$job.plist"
    launchctl unload "$LA/com.twin.$job.plist" 2>/dev/null || true
    launchctl load "$LA/com.twin.$job.plist"
  done
  say "Scheduled nightly (02:30) + weekly (Sun 03:00) jobs"
elif [ "$DO_LAUNCHD" = "1" ]; then
  say "Not macOS: skipping launchd. Add cron jobs: 'twin nightly' daily, 'twin weekly' weekly."
fi

# --- 6. optional: obsidian skills + defuddle ---
if [ "$WITH_SKILLS" = "1" ]; then
  say "Installing kepano/obsidian-skills + defuddle"
  command -v npm >/dev/null 2>&1 && npm install -g defuddle || echo "   (npm not found; skip defuddle)"
  tmp="$(mktemp -d)"; git clone --depth 1 -q https://github.com/kepano/obsidian-skills "$tmp" 2>/dev/null \
    && mkdir -p "$HOME/.claude/skills" && cp -R "$tmp/skills/"* "$HOME/.claude/skills/" \
    && echo "   installed obsidian-skills" || echo "   (could not fetch obsidian-skills)"
fi

# --- 7. git init the vault ---
if [ ! -d "$TWIN_DIR/.git" ]; then
  ( cd "$TWIN_DIR" && git init -q && git add -A && git -c commit.gpgsign=false commit -q -m "twin: init vault" )
  say "Initialized git in $TWIN_DIR (push to your own PRIVATE remote when ready)"
fi

cat <<EOF

✅ twin installed.

  vault : $TWIN_DIR
  cli   : twin help

Try it:
  twin capture "twin is my new second brain"
  twin ingest
  twin ask "what do I know about twin?"

Make it yours: open $TWIN_DIR in Obsidian (Open folder as vault) for the graph view.
Keep your data PRIVATE: push $TWIN_DIR to a private repo, not a public one.
EOF

#!/usr/bin/env bash
# twin one-line installer.
#   curl -fsSL https://raw.githubusercontent.com/Arsh-S/twin-brain/main/bootstrap.sh | bash
# Clones (or updates) the framework, then runs install.sh. Pass install.sh args after `--`:
#   curl -fsSL .../bootstrap.sh | bash -s -- --dir ~/brain --no-launchd
# Prefer to read the code first? Just clone the repo and run ./install.sh yourself.
set -euo pipefail

REPO_URL="${TWIN_REPO_URL:-https://github.com/Arsh-S/twin-brain.git}"
SRC="${TWIN_SRC:-$HOME/twin-framework}"   # where the framework clone lives (not your vault)

say() { printf '\033[1;34m::\033[0m %s\n' "$*"; }

command -v git >/dev/null 2>&1 || { echo "ERROR: git not found. Install git first." >&2; exit 1; }

if [ -d "$SRC/.git" ]; then
  say "Updating existing framework at $SRC"
  git -C "$SRC" pull --ff-only -q || say "(could not fast-forward; using the local copy as-is)"
else
  say "Cloning twin framework into $SRC"
  git clone --depth 1 -q "$REPO_URL" "$SRC"
fi

say "Running installer"
# Default to --with-skills (obsidian-skills + defuddle) unless the caller passes their own flags.
if [ "$#" -eq 0 ]; then
  exec bash "$SRC/install.sh" --with-skills
else
  exec bash "$SRC/install.sh" "$@"
fi

#!/usr/bin/env bash
# Add this repo's shared skills and MCP servers to this machine's Claude Code (macOS / Linux).
# Only adds things: your own skills, settings, CLAUDE.md and other MCP servers are left alone.
# Safe to re-run; run it again after every `git pull`.
# Usage:  bash setup.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
SKILLS="$HOME/.claude/skills"
mkdir -p "$SKILLS"

# 0. Prerequisites. Servers register fine without these, then fail at startup in every session.
echo "==> Checking prerequisites"
missing=0
if ! command -v claude >/dev/null 2>&1; then
  echo "    'claude' not found. Install Claude Code with the native installer."; missing=1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "    'node' not found. Install Node 20 or later."; missing=1
elif [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "    WARNING: Node $(node -v) is too old; playwright needs 20 or later."
fi
if ! command -v uvx >/dev/null 2>&1; then
  echo "    WARNING: 'uvx' not found; fetch, time, git, duckduckgo and wikipedia won't start. Install uv."
fi

# 1. Skills: one link per shared skill, so personal skills never end up in this repo.
echo "==> Skills"
# If ~/.claude/skills is itself a link into another git repo (e.g. a private config repo),
# keep our links out of that repo's commits.
exclude=""
real="$(cd "$SKILLS" && pwd -P)"
if top="$(git -C "$real" rev-parse --show-toplevel 2>/dev/null)"; then
  exclude="$(git -C "$top" rev-parse --absolute-git-dir)/info/exclude"
  mkdir -p "$(dirname "$exclude")"
  touch "$exclude"
fi

for src in "$REPO"/skills/*/; do
  [ -f "$src/SKILL.md" ] || continue
  name="$(basename "$src")"
  dest="$SKILLS/$name"
  if [ -L "$dest" ] && [[ "$(readlink "$dest")" == "$REPO/skills/"* ]]; then
    : # already ours
  elif [ -e "$dest" ] || [ -L "$dest" ]; then
    echo "    skipped $name: you already have a skill with that name (yours wins)"
    continue
  else
    ln -s "$REPO/skills/$name" "$dest"
    echo "    linked $name"
  fi
  if [ -n "$exclude" ]; then
    rel="/${real#"$top"/}/$name"
    grep -qxF "$rel" "$exclude" || echo "$rel" >> "$exclude"
  fi
done

# Remove links to skills that were deleted from the repo.
for dest in "$SKILLS"/*; do
  if [ -L "$dest" ] && [[ "$(readlink "$dest")" == "$REPO/skills/"* ]] && [ ! -e "$dest" ]; then
    rm "$dest"
    echo "    removed $(basename "$dest") (no longer in the repo)"
  fi
done

# 2. MCP servers: registered from mcp/servers.json at user scope
echo "==> MCP servers"
if [ "$missing" -eq 0 ]; then
  node "$REPO/mcp/apply.mjs"
else
  echo "    Skipped. Install the missing tools above, then re-run this script."
fi

echo
echo "Done. Start a new Claude Code session to load everything."

#!/bin/bash
# Remove orphan Claude Code sessions left behind by older versions of
# claude-session-topics, when the headless `claude -p` title-generation run
# persisted its own transcript under ~/.claude/projects/<cwd>/. Those show up in
# the IDE session list with the title prompt as their preview.
#
# Fixed in 5.3.3 via --no-session-persistence; this purges the ones already on disk.
#
# Usage:
#   ./scripts/cleanup-orphan-sessions.sh            # dry-run: list what would be deleted
#   ./scripts/cleanup-orphan-sessions.sh --apply    # actually delete

set -euo pipefail

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

PROJECTS_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"

# Signature of the title-generation prompt (matches the instruction in
# user-prompt-hook.sh). Only files whose first user message contains this are
# considered orphans.
SIGNATURE='Genera un título corto'

# Defensive cap: real sessions are longer than a single title-gen round-trip.
MAX_LINES=20

if [ ! -d "$PROJECTS_DIR" ]; then
  echo "No projects directory at $PROJECTS_DIR — nothing to do."
  exit 0
fi

HAS_JQ=0
command -v jq >/dev/null 2>&1 && HAS_JQ=1

# Returns 0 if the first user message of $1 matches the title-gen signature.
is_orphan() {
  local file="$1" first
  if [ "$HAS_JQ" = "1" ]; then
    first=$(jq -r 'select(.type=="user") | (.message.content // "") | tostring' "$file" 2>/dev/null | head -n 1)
    case "$first" in
      *"$SIGNATURE"*) return 0 ;;
      *) return 1 ;;
    esac
  fi
  # jq-less fallback: scan the first few KB for the signature.
  head -c 4000 "$file" 2>/dev/null | grep -q "$SIGNATURE"
}

found=0
deleted=0
while IFS= read -r -d '' file; do
  lines=$(wc -l <"$file" 2>/dev/null | tr -d ' ')
  [ -z "$lines" ] && continue
  [ "$lines" -gt "$MAX_LINES" ] && continue
  is_orphan "$file" || continue
  found=$((found + 1))
  if [ "$APPLY" = "1" ]; then
    rm -f "$file" && deleted=$((deleted + 1))
    echo "deleted: $file"
  else
    echo "would delete: $file (${lines} lines)"
  fi
done < <(find "$PROJECTS_DIR" -type f -name '*.jsonl' -print0 2>/dev/null)

echo
if [ "$APPLY" = "1" ]; then
  echo "Deleted $deleted orphan session(s)."
else
  echo "Found $found orphan session(s). Re-run with --apply to delete them."
fi

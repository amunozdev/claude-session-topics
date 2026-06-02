#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Load common functions if available (for debug_log)
if [ -f "$SCRIPT_DIR/../lib/common.sh" ]; then
  source "$SCRIPT_DIR/../lib/common.sh"
elif [ -f "$SCRIPT_DIR/lib/common.sh" ]; then
  source "$SCRIPT_DIR/lib/common.sh"
else
  debug_log() { :; }
fi

input=$(cat)

# ── Parse JSON — session_id is the primary identifier (no PID needed)
SESSION_ID=$(echo "$input" | jq -r '.session_id // ""')
SESSION_ID=$(echo "$SESSION_ID" | tr -cd 'a-zA-Z0-9_-')
TRANSCRIPT_PATH=$(echo "$input" | jq -r '.transcript_path // ""')
if [ -z "$SESSION_ID" ]; then
    debug_log "statusline: no session_id, exiting"
    exit 0
fi

debug_log "statusline: session_id=$SESSION_ID"

# ── Topic lookup: use session_id directly (no PID-based lookup needed)
TOPIC=""
TOPIC_FILE="$HOME/.claude/session-topics/${SESSION_ID}"
if [ -f "$TOPIC_FILE" ]; then
    TOPIC=$(cat "$TOPIC_FILE" 2>/dev/null || echo "")
    debug_log "statusline: found topic '$TOPIC' from file"
fi

# If topic file doesn't exist, try to read Claude Code's internal custom-title
if [ -z "$TOPIC" ] && [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
    CUSTOM_TITLE=$(grep '"custom-title"' "$TRANSCRIPT_PATH" 2>/dev/null | tail -1 | jq -r '.customTitle // ""' 2>/dev/null || echo "")
    if [ -n "$CUSTOM_TITLE" ]; then
        TOPIC=$(echo "$CUSTOM_TITLE" | tr '-' ' ' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)} 1')
        TOPIC=$(echo "$TOPIC" | cut -c1-50)
        if [ -n "$TOPIC" ]; then
            mkdir -p "$HOME/.claude/session-topics"
            printf '%s\n' "$TOPIC" > "$TOPIC_FILE"
            debug_log "statusline: extracted topic '$TOPIC' from custom-title"
        fi
    fi
fi
if [ -z "$TOPIC" ] && [ -n "${CLAUDE_SESSION_TOPICS_TOPIC:-}" ]; then
    TOPIC="$CLAUDE_SESSION_TOPICS_TOPIC"
    if [ -n "$SESSION_ID" ]; then
        mkdir -p "$HOME/.claude/session-topics"
        echo "$TOPIC" > "$HOME/.claude/session-topics/${SESSION_ID}"
    fi
fi

# ── Resolve topic color
resolve_color() {
    case "$1" in
        red)       echo '\033[31m' ;;
        green)     echo '\033[32m' ;;
        yellow)    echo '\033[33m' ;;
        blue)      echo '\033[34m' ;;
        magenta)   echo '\033[35m' ;;
        cyan)      echo '\033[36m' ;;
        white)     echo '\033[37m' ;;
        orange)    echo '\033[38;5;208m' ;;
        grey|gray) echo '\033[90m' ;;
        none)      echo '' ;;
        "")        echo '\033[36m' ;;  # default: cyan (ANSI palette — adapts to terminal theme)
        *)
            if echo "$1" | grep -qE '^[0-9;]+$'; then
                echo "\033[${1}m"
            else
                echo '\033[36m'
            fi
            ;;
    esac
}
# Color priority: env var > config file > default (cyan)
_color="${CLAUDE_SESSION_TOPICS_COLOR:-}"
if [ -z "$_color" ] && [ -f "$HOME/.claude/session-topics/.color-config" ]; then
    _color=$(cat "$HOME/.claude/session-topics/.color-config" 2>/dev/null || echo "")
fi
C_TOPIC=$(resolve_color "$_color")
C_BOLD='\033[1m'
C_RESET='\033[0m'

# ── Run user's original statusline command (if any)
ORIG_OUTPUT=""
ORIG_CMD_FILE="$HOME/.claude/session-topics/.original-statusline-cmd"
if [ -f "$ORIG_CMD_FILE" ]; then
    ORIG_CMD=$(cat "$ORIG_CMD_FILE" 2>/dev/null || echo "")
    if [ -n "$ORIG_CMD" ]; then
        ORIG_OUTPUT=$(echo "$input" | bash -c "$ORIG_CMD" 2>/dev/null || echo "")
    fi
fi

# ── Output
TOPIC_OUTPUT=""
if [ -n "$TOPIC" ]; then
    TOPIC_OUTPUT="${C_BOLD}${C_TOPIC}◆ ${TOPIC}${C_RESET}"
fi

if [ -n "$TOPIC_OUTPUT" ] && [ -n "$ORIG_OUTPUT" ]; then
    echo -e "${TOPIC_OUTPUT} | ${ORIG_OUTPUT}"
elif [ -n "$TOPIC_OUTPUT" ]; then
    echo -e "${TOPIC_OUTPUT}"
elif [ -n "$ORIG_OUTPUT" ]; then
    echo -e "${ORIG_OUTPUT}"
fi

#!/bin/bash
# Common utility functions for claude-session-topics scripts

# ── Debug logging (enable with CLAUDE_SESSION_TOPICS_DEBUG=1)
debug_log() {
  if [ "${CLAUDE_SESSION_TOPICS_DEBUG:-0}" = "1" ]; then
    echo "[$(date '+%H:%M:%S')] $*" >> "$HOME/.claude/session-topics/debug.log" 2>/dev/null || true
  fi
}

# ── Find the ancestor claude process PID (best-effort, not required)
# NOTE: This is kept for backward compatibility but is NOT the primary
# session identification mechanism. Use session_id from JSON input instead.
find_claude_pid() {
  local pid=$$
  debug_log "find_claude_pid: starting walk from PID $$"
  while [ "$pid" != "1" ] && [ -n "$pid" ]; do
    local parent
    parent=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    [ -z "$parent" ] && break
    local comm
    comm=$(ps -o comm= -p "$parent" 2>/dev/null)
    debug_log "find_claude_pid: pid=$pid parent=$parent comm=$comm"
    case "$comm" in
      *claude*|*Claude*) debug_log "find_claude_pid: found $parent"; echo "$parent"; return 0 ;;
    esac
    pid=$parent
  done
  debug_log "find_claude_pid: no claude ancestor found"
  echo ""
}

# ── Sanitize session ID (keep only alphanumeric, underscore, hyphen)
sanitize_session_id() {
  echo "$1" | tr -cd 'a-zA-Z0-9_-' 2>/dev/null || echo ""
}

# ── Ensure topics directory exists
ensure_topics_dir() {
  mkdir -p "$HOME/.claude/session-topics"
}

# ── Get path to session topic file
get_session_file() {
  local session_id="$1"
  echo "$HOME/.claude/session-topics/${session_id}"
}

# ── Run a command with a timeout, portable across systems without coreutils
# Uses timeout/gtimeout if available, otherwise a pure-bash watchdog.
# macOS ships neither timeout nor gtimeout by default.
run_with_timeout() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout "$secs" "$@"; return $?; fi
  if command -v gtimeout >/dev/null 2>&1; then gtimeout "$secs" "$@"; return $?; fi
  "$@" &
  local cmd_pid=$!
  ( sleep "$secs"; kill -TERM "$cmd_pid" 2>/dev/null ) &
  local watch_pid=$!
  wait "$cmd_pid" 2>/dev/null; local rc=$?
  kill -TERM "$watch_pid" 2>/dev/null; wait "$watch_pid" 2>/dev/null
  return "$rc"
}

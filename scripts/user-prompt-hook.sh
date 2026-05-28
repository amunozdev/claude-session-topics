#!/bin/bash
set -euo pipefail

# ── UserPromptSubmit hook: deterministic topic generation per user message
# Receives event JSON on stdin: {"session_id", "transcript_path", "prompt"}
#
# Two-phase flow:
#   1. Synchronous heuristic from the prompt → topic visible in <200ms
#   2. Async `claude -p` refinement in background → overrides heuristic
#
# Precedence (single source of truth):
#   manual > custom-title > refined > heuristic > empty

# ── Recursion guard: spawned `claude -p` would trigger this hook again
if [ "${CLAUDE_SESSION_TOPICS_SKIP:-0}" = "1" ]; then
  exit 0
fi

# ── Load common functions (with fallback for installed location)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/lib/common.sh" ]; then
  source "$SCRIPT_DIR/lib/common.sh"
elif [ -f "$SCRIPT_DIR/../scripts/lib/common.sh" ]; then
  source "$SCRIPT_DIR/../scripts/lib/common.sh"
else
  debug_log() { :; }
  sanitize_session_id() { echo "$1" | tr -cd 'a-zA-Z0-9_-'; }
  ensure_topics_dir() { mkdir -p "$HOME/.claude/session-topics"; }
  find_claude_pid() { echo ""; }
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
fi

input=$(cat)

SESSION_ID=$(echo "$input" | jq -r '.session_id // ""')
TRANSCRIPT_PATH=$(echo "$input" | jq -r '.transcript_path // ""')
PROMPT=$(echo "$input" | jq -r '.prompt // ""')

SESSION_ID=$(sanitize_session_id "$SESSION_ID")
[ -z "$SESSION_ID" ] && exit 0

ensure_topics_dir

TOPICS_DIR="$HOME/.claude/session-topics"
TOPIC_FILE="$TOPICS_DIR/${SESSION_ID}"
SOURCE_FILE="$TOPICS_DIR/.source-${SESSION_ID}"
MANUAL_MARKER="$TOPICS_DIR/.manual-set-${SESSION_ID}"
TURNS_FILE="$TOPICS_DIR/.turns-${SESSION_ID}"
REFINE_LOCK="$TOPICS_DIR/.refine-lock-${SESSION_ID}"
REFINE_LAST="$TOPICS_DIR/.refine-last-${SESSION_ID}"

# ── Active session markers (statusline + skill resolution)
echo "$SESSION_ID" > "$TOPICS_DIR/.active-session-id-${SESSION_ID}"
CLAUDE_PID=$(find_claude_pid)
if [ -n "$CLAUDE_PID" ]; then
  echo "$SESSION_ID" > "$TOPICS_DIR/.active-session-${CLAUDE_PID}"
fi

# ── Increment turn counter (used to allow periodic refine of `refined` topics)
TURNS=0
[ -f "$TURNS_FILE" ] && TURNS=$(cat "$TURNS_FILE" 2>/dev/null || echo 0)
TURNS=$((TURNS + 1))
printf '%s' "$TURNS" > "$TURNS_FILE"

debug_log "user-prompt-hook: session=$SESSION_ID turn=$TURNS prompt_len=${#PROMPT}"

# ── Manual override: never touch
if [ -f "$MANUAL_MARKER" ]; then
  debug_log "user-prompt-hook: manual marker present, exiting"
  exit 0
fi

CURRENT_SOURCE=""
[ -f "$SOURCE_FILE" ] && CURRENT_SOURCE=$(cat "$SOURCE_FILE" 2>/dev/null || echo "")

# ── Decide what to do based on current source
SHOULD_HEURISTIC=0
SHOULD_REFINE=0
case "$CURRENT_SOURCE" in
  manual)
    exit 0
    ;;
  custom-title)
    # Custom-title is high quality; only refine on big turn jumps (every 5 turns)
    [ $((TURNS % 5)) -eq 0 ] && SHOULD_REFINE=1
    ;;
  refined)
    # Periodic refresh every 3 turns
    [ $((TURNS % 3)) -eq 0 ] && SHOULD_REFINE=1
    ;;
  heuristic|"")
    SHOULD_HEURISTIC=1
    SHOULD_REFINE=1
    ;;
esac

[ -z "$PROMPT" ] && exit 0

# ── Synchronous heuristic
extract_heuristic() {
  local text="$1"
  # First 200 chars only
  text=$(printf '%s' "$text" | head -c 200)
  # Detect language by diacritics → influences stop-word list
  local lang="en"
  if printf '%s' "$text" | LC_ALL=C grep -qE '[ñÑ¿¡áéíóúÁÉÍÓÚ]'; then
    lang="es"
  fi
  # Strip attachment markers (e.g. "[Image #1]") and leading "Image"/"Imagen" noise
  local stripped
  stripped=$(printf '%s' "$text" | sed -E 's/\[[^]]*\]//g; s/^[[:space:]]*(image|imagen)[[:space:]#0-9]*//I')
  # Strip leading greetings/fillers (case-insensitive) — bilingual, repeatable
  while :; do
    local before="$stripped"
    stripped=$(printf '%s' "$stripped" | sed -E 's/^[[:space:]]*(hola|hi|hey|hello|ok|okay|dale|bien|bueno|ahora|entonces|a ver|veamos|oye|por favor|please|can you|could you|puedes|podrías|necesito|quiero|i want|i need|me gustaría|i would like|let'"'"'s|vamos a)[[:space:],:.!?-]+//I')
    [ "$stripped" = "$before" ] && break
  done
  # Tokenize: keep alphanumerics + some technical chars within words
  local tokens
  tokens=$(printf '%s' "$stripped" | tr -c '[:alnum:]_\-áéíóúñÁÉÍÓÚÑ' '\n' | grep -v '^$' || true)
  # Stop-words bilingual (lowercased match)
  local stop_re
  if [ "$lang" = "es" ]; then
    stop_re='^(el|la|los|las|un|una|unos|unas|de|del|al|a|y|o|u|en|con|sin|por|para|que|qué|cómo|como|es|ser|son|está|estoy|estás|estamos|este|esta|esto|esos|esas|mi|tu|su|le|me|te|se|lo|no|sí|si|ya|pero|muy|más|también|sólo|solo|hay|hace|hacer|tengo|tener|tiene|aquí|ahí|allí)$'
  else
    stop_re='^(the|a|an|of|to|in|on|at|by|for|with|and|or|but|is|are|was|were|be|been|being|am|do|does|did|done|i|you|he|she|it|we|they|me|us|them|my|your|his|her|its|our|their|this|that|these|those|so|just|very|more|also|any|some|no|not|yes|here|there)$'
  fi
  # Filter tokens
  local picked=()
  local seen_lower=""
  while IFS= read -r tok; do
    [ -z "$tok" ] && continue
    [ ${#tok} -lt 2 ] && continue
    local lower
    lower=$(printf '%s' "$tok" | tr '[:upper:]' '[:lower:]')
    # Stop-words
    if echo "$lower" | grep -qE "$stop_re"; then
      continue
    fi
    # De-dup
    case " $seen_lower " in
      *" $lower "*) continue ;;
    esac
    seen_lower="$seen_lower $lower"
    picked+=("$tok")
    [ "${#picked[@]}" -ge 4 ] && break
  done <<< "$tokens"

  if [ "${#picked[@]}" -eq 0 ]; then
    # Fallback: first 3 raw words — only if there are ≥2 of them. With a single
    # short word (e.g. "Si", "Procedé") leave the topic empty and wait for the
    # async refinement instead of writing noise.
    local raw=()
    while IFS= read -r tok; do
      [ -n "$tok" ] && raw+=("$tok")
    done < <(printf '%s' "$stripped" | awk '{for(i=1;i<=3 && i<=NF;i++) print $i}')
    if [ "${#raw[@]}" -ge 2 ]; then
      picked=("${raw[@]}")
    fi
  fi

  # Drop bilingual acknowledgements that slip past the language-specific stop
  # lists (short words like "Si" have no diacritics → detected as English).
  local ack_re='^(si|sí|no|ok|okay|dale|listo|claro|dale|sip|nop|yep|yes|nope|procede|procedé|gracias|thanks)$'
  if [ "${#picked[@]}" -gt 0 ]; then
    local kept=()
    for t in "${picked[@]}"; do
      local lt
      lt=$(printf '%s' "$t" | tr '[:upper:]' '[:lower:]')
      echo "$lt" | grep -qE "$ack_re" && continue
      kept+=("$t")
    done
    picked=()
    [ "${#kept[@]}" -gt 0 ] && picked=("${kept[@]}")
  fi

  # A lone short token gives no session context — wait for refinement instead.
  if [ "${#picked[@]}" -eq 1 ] && [ "${#picked[0]}" -lt 4 ]; then
    picked=()
  fi

  # Nothing worth showing — leave empty and wait for async refinement
  [ "${#picked[@]}" -eq 0 ] && { printf '%s' ""; return 0; }

  # Title-case: capitalize first letter of each token; keep ALL-CAPS techie tokens intact
  local out=""
  for t in "${picked[@]}"; do
    if echo "$t" | grep -qE '^[A-Z0-9]{2,}$'; then
      out="$out $t"
    elif echo "$t" | grep -qE '[A-Z]'; then
      # Mixed case (camelCase / PascalCase) — keep
      out="$out $t"
    else
      local first rest
      first=$(printf '%s' "$t" | cut -c1 | tr '[:lower:]' '[:upper:]')
      rest=$(printf '%s' "$t" | cut -c2-)
      out="$out ${first}${rest}"
    fi
  done
  out=$(printf '%s' "$out" | sed -E 's/^[[:space:]]+//;s/[[:space:]]+$//' | cut -c1-50)
  printf '%s' "$out"
}

write_topic_atomic() {
  local content="$1"
  local source="$2"
  local tmp="${TOPIC_FILE}.tmp.$$"
  printf '%s\n' "$content" > "$tmp"
  mv "$tmp" "$TOPIC_FILE"
  printf '%s' "$source" > "$SOURCE_FILE"
}

if [ "$SHOULD_HEURISTIC" = "1" ]; then
  HEURISTIC_TOPIC=$(extract_heuristic "$PROMPT" 2>/dev/null || echo "")
  if [ -n "$HEURISTIC_TOPIC" ]; then
    write_topic_atomic "$HEURISTIC_TOPIC" "heuristic"
    debug_log "user-prompt-hook: wrote heuristic topic '$HEURISTIC_TOPIC'"
  fi
fi

# ── Async refinement via claude -p
refine_topic() {
  local prompt_text="$1"
  local transcript="$2"

  # Rate limit: bail if last refine < 15s ago
  if [ -f "$REFINE_LAST" ]; then
    local last_mtime now diff
    last_mtime=$(stat -f %m "$REFINE_LAST" 2>/dev/null || stat -c %Y "$REFINE_LAST" 2>/dev/null || echo 0)
    now=$(date +%s)
    diff=$((now - last_mtime))
    [ "$diff" -lt 15 ] && return 0
  fi

  # Single-flight via atomic mkdir (flock is unavailable on macOS)
  local lockdir="${REFINE_LOCK}.d"
  # Steal a stale lock (>120s) left by a killed process
  if [ -d "$lockdir" ]; then
    local lk_mtime lk_now
    lk_mtime=$(stat -f %m "$lockdir" 2>/dev/null || stat -c %Y "$lockdir" 2>/dev/null || echo 0)
    lk_now=$(date +%s)
    [ "$((lk_now - lk_mtime))" -ge 120 ] && rmdir "$lockdir" 2>/dev/null
  fi
  if ! mkdir "$lockdir" 2>/dev/null; then
    return 0
  fi
  trap 'rmdir "$lockdir" 2>/dev/null || true' RETURN

  # Build context: current prompt + last 3 user messages from transcript (cap ~2KB)
  local context="$prompt_text"
  if [ -n "$transcript" ] && [ -f "$transcript" ]; then
    local prior
    prior=$(jq -r 'select(.type=="user") | (.message.content // "") | tostring' "$transcript" 2>/dev/null \
            | tail -n 4 | head -n 3 | tr '\n' ' ' | head -c 1500)
    if [ -n "$prior" ]; then
      context="$prior"$'\n\n'"$prompt_text"
    fi
  fi
  context=$(printf '%s' "$context" | head -c 2000)

  # Detect command
  if ! command -v claude >/dev/null 2>&1; then
    return 0
  fi

  local instruction='Genera un título corto (2 a 5 palabras, máximo 50 caracteres) que describa el tema de esta conversación. Responde ÚNICAMENTE con el título: sin comillas, sin explicación, sin puntuación final. Mismo idioma que el usuario.'
  local full_prompt
  full_prompt=$(printf '%s\n\nConversación:\n%s' "$instruction" "$context")

  local refined out_file="${TOPIC_FILE}.refine.$$"
  printf '%s' "$full_prompt" | CLAUDE_SESSION_TOPICS_SKIP=1 \
    run_with_timeout 30 claude -p --model haiku --max-turns 1 >"$out_file" 2>/dev/null || true
  refined=$(tr -d '\r' < "$out_file" 2>/dev/null | grep -v '^[[:space:]]*$' | head -n 1 || true)
  rm -f "$out_file"

  # Sanitize: strip quotes, trim, whitelist chars, truncate
  refined=$(printf '%s' "$refined" \
            | sed -E 's/^[[:space:]"'"'"'`]+//;s/[[:space:]"'"'"'`.,:;!?]+$//' \
            | tr -d '\n' \
            | LC_ALL=C sed 's/[^[:alnum:] áéíóúÁÉÍÓÚñÑ¿¡!?.,:_-]//g' \
            | cut -c1-50)

  [ -z "$refined" ] && return 0

  # Re-check manual marker (user may have set during the async window)
  [ -f "$MANUAL_MARKER" ] && return 0

  write_topic_atomic "$refined" "refined"
  touch "$REFINE_LAST"
  debug_log "user-prompt-hook: wrote refined topic '$refined'"
}

if [ "$SHOULD_REFINE" = "1" ]; then
  (
    refine_topic "$PROMPT" "$TRANSCRIPT_PATH" || true
  ) </dev/null >/dev/null 2>&1 &
  disown 2>/dev/null || true
fi

exit 0

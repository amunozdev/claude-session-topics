---
name: set-topic
description: Set or change the session topic displayed in the statusline
argument-hint: <topic text>
allowed-tools: [Bash]
version: "5.4.2"
---

Set the session topic to: $ARGUMENTS

If the text is empty, tell the user to provide a topic (e.g., `/set-topic Auth Refactor`).

## Steps

1. Sanitize the topic: keep only letters, numbers, spaces, accented characters and `.,-:!?'` — truncate to 50 characters.
2. Run the bash block below, replacing `YOUR_TOPIC_HERE` with the sanitized topic.
3. Confirm to the user: `Topic set to: <topic>`.

```bash
resolve_session_id() {
  local latest sid
  latest=$(ls -t "$HOME/.claude/session-topics"/.active-session-id-* 2>/dev/null | head -1)
  if [ -n "$latest" ]; then
    sid=$(basename "$latest" | sed 's/^\.active-session-id-//')
    sid=$(echo "$sid" | tr -cd 'a-zA-Z0-9_-')
    [ -n "$sid" ] && echo "$sid" && return 0
  fi
  local pid=$$
  while [ "$pid" != "1" ] && [ -n "$pid" ]; do
    local parent comm
    parent=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    [ -z "$parent" ] && break
    comm=$(ps -o comm= -p "$parent" 2>/dev/null)
    case "$comm" in
      *claude*|*Claude*)
        sid=$(cat "$HOME/.claude/session-topics/.active-session-$parent" 2>/dev/null)
        sid=$(echo "$sid" | tr -cd 'a-zA-Z0-9_-')
        [ -n "$sid" ] && echo "$sid" && return 0
        break ;;
    esac
    pid=$parent
  done
  echo ""
}

SESSION_ID=$(resolve_session_id)
if [ -z "$SESSION_ID" ]; then
  echo "No active session found."
  exit 1
fi

mkdir -p "$HOME/.claude/session-topics"
TOPIC_FILE="$HOME/.claude/session-topics/${SESSION_ID}"
tmp="${TOPIC_FILE}.tmp.$$"
printf '%s\n' "YOUR_TOPIC_HERE" > "$tmp"
mv "$tmp" "$TOPIC_FILE"

# Mark as manual so hooks won't overwrite
touch "$HOME/.claude/session-topics/.manual-set-${SESSION_ID}"
printf 'manual' > "$HOME/.claude/session-topics/.source-${SESSION_ID}"
```

The manual marker prevents the UserPromptSubmit and Stop hooks from overwriting the topic for the rest of the session.

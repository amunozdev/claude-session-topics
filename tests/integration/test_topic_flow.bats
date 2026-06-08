#!/usr/bin/env bats

load helper

@test "test_hook_writes_session_markers" {
  local hook_input='{"session_id": "'$TEST_SESSION_ID'", "transcript_path": "/nonexistent"}'

  run bash "$PROJECT_ROOT/scripts/auto-topic-hook.sh" <<< "$hook_input"

  [ "$status" -eq 0 ]
  [ -f "$TOPICS_DIR/.active-session-id-$TEST_SESSION_ID" ]
}

@test "test_hook_reads_custom_title_from_transcript" {
  # Create a transcript with a custom-title entry
  local tmpfile="$BATS_TEST_TMPDIR/transcript.jsonl"
  echo '{"type": "user", "message": {"content": "Fix the login"}}' > "$tmpfile"
  echo '{"type": "assistant", "message": {"content": "Sure"}}' >> "$tmpfile"
  echo '{"type": "custom-title", "customTitle": "fix-login-redirect-bug", "sessionId": "'$TEST_SESSION_ID'"}' >> "$tmpfile"

  local hook_input='{"session_id": "'$TEST_SESSION_ID'", "transcript_path": "'$tmpfile'"}'
  run bash "$PROJECT_ROOT/scripts/auto-topic-hook.sh" <<< "$hook_input"

  [ "$status" -eq 0 ]
  [ -f "$TOPICS_DIR/$TEST_SESSION_ID" ]

  local topic_content
  topic_content=$(cat "$TOPICS_DIR/$TEST_SESSION_ID")
  [[ "$topic_content" == "Fix Login Redirect Bug" ]]
}

@test "test_hook_uses_latest_custom_title" {
  # Transcript with multiple custom-title entries (title gets updated)
  local tmpfile="$BATS_TEST_TMPDIR/transcript.jsonl"
  echo '{"type": "custom-title", "customTitle": "initial-topic", "sessionId": "'$TEST_SESSION_ID'"}' > "$tmpfile"
  echo '{"type": "user", "message": {"content": "Actually, fix the auth"}}' >> "$tmpfile"
  echo '{"type": "custom-title", "customTitle": "fix-auth-token-refresh", "sessionId": "'$TEST_SESSION_ID'"}' >> "$tmpfile"

  local hook_input='{"session_id": "'$TEST_SESSION_ID'", "transcript_path": "'$tmpfile'"}'
  run bash "$PROJECT_ROOT/scripts/auto-topic-hook.sh" <<< "$hook_input"

  [ "$status" -eq 0 ]

  local topic_content
  topic_content=$(cat "$TOPICS_DIR/$TEST_SESSION_ID")
  [[ "$topic_content" == "Fix Auth Token Refresh" ]]
}

@test "test_hook_no_topic_without_custom_title" {
  # Transcript without custom-title — no topic should be written
  local tmpfile="$BATS_TEST_TMPDIR/transcript.jsonl"
  echo '{"type": "user", "message": {"content": "Hello"}}' > "$tmpfile"
  echo '{"type": "assistant", "message": {"content": "Hi"}}' >> "$tmpfile"

  local hook_input='{"session_id": "'$TEST_SESSION_ID'", "transcript_path": "'$tmpfile'"}'
  run bash "$PROJECT_ROOT/scripts/auto-topic-hook.sh" <<< "$hook_input"

  [ "$status" -eq 0 ]
  [ ! -f "$TOPICS_DIR/$TEST_SESSION_ID" ]
}

@test "test_hook_upgrades_heuristic_to_custom_title" {
  # Heuristic topic exists; Stop hook should upgrade it from custom-title
  echo "Heuristic Topic" > "$TOPICS_DIR/$TEST_SESSION_ID"
  printf 'heuristic' > "$TOPICS_DIR/.source-$TEST_SESSION_ID"

  local tmpfile="$BATS_TEST_TMPDIR/transcript.jsonl"
  echo '{"type": "custom-title", "customTitle": "different-hook-title", "sessionId": "'$TEST_SESSION_ID'"}' > "$tmpfile"

  local hook_input='{"session_id": "'$TEST_SESSION_ID'", "transcript_path": "'$tmpfile'"}'
  run bash "$PROJECT_ROOT/scripts/auto-topic-hook.sh" <<< "$hook_input"

  [ "$status" -eq 0 ]

  local topic_content source_content
  topic_content=$(cat "$TOPICS_DIR/$TEST_SESSION_ID")
  source_content=$(cat "$TOPICS_DIR/.source-$TEST_SESSION_ID")
  [[ "$topic_content" == "Different Hook Title" ]]
  [[ "$source_content" == "custom-title" ]]

  rm -f "$TOPICS_DIR/.source-$TEST_SESSION_ID"
}

@test "test_hook_preserves_manual_topic" {
  # Manual marker present → Stop hook must not overwrite
  echo "My Manual Topic" > "$TOPICS_DIR/$TEST_SESSION_ID"
  touch "$TOPICS_DIR/.manual-set-$TEST_SESSION_ID"
  printf 'manual' > "$TOPICS_DIR/.source-$TEST_SESSION_ID"

  local tmpfile="$BATS_TEST_TMPDIR/transcript.jsonl"
  echo '{"type": "custom-title", "customTitle": "should-not-win", "sessionId": "'$TEST_SESSION_ID'"}' > "$tmpfile"

  local hook_input='{"session_id": "'$TEST_SESSION_ID'", "transcript_path": "'$tmpfile'"}'
  run bash "$PROJECT_ROOT/scripts/auto-topic-hook.sh" <<< "$hook_input"

  [ "$status" -eq 0 ]
  [[ "$(cat "$TOPICS_DIR/$TEST_SESSION_ID")" == "My Manual Topic" ]]

  rm -f "$TOPICS_DIR/.manual-set-$TEST_SESSION_ID" "$TOPICS_DIR/.source-$TEST_SESSION_ID"
}

@test "test_user_prompt_hook_writes_heuristic_topic" {
  # Use SKIP=1 to avoid spawning claude -p
  local hook_input='{"session_id": "'$TEST_SESSION_ID'", "transcript_path": "/nonexistent", "prompt": "Fix the NeonDB auth session bug"}'
  CLAUDE_SESSION_TOPICS_SKIP=0 run bash "$PROJECT_ROOT/scripts/user-prompt-hook.sh" <<< "$hook_input"

  [ "$status" -eq 0 ]
  [ -f "$TOPICS_DIR/$TEST_SESSION_ID" ]
  [ -f "$TOPICS_DIR/.source-$TEST_SESSION_ID" ]

  local source_content topic_content
  source_content=$(cat "$TOPICS_DIR/.source-$TEST_SESSION_ID")
  topic_content=$(cat "$TOPICS_DIR/$TEST_SESSION_ID")
  [[ "$source_content" == "heuristic" ]]
  # Heuristic should drop "Fix" + "the" stop-words, keep tech tokens
  [[ "$topic_content" == *"NeonDB"* ]] || [[ "$topic_content" == *"Auth"* ]]

  rm -f "$TOPICS_DIR/.source-$TEST_SESSION_ID" "$TOPICS_DIR/.turns-$TEST_SESSION_ID" "$TOPICS_DIR/.refine-lock-$TEST_SESSION_ID"
}

@test "test_user_prompt_hook_respects_manual_marker" {
  echo "Locked Topic" > "$TOPICS_DIR/$TEST_SESSION_ID"
  touch "$TOPICS_DIR/.manual-set-$TEST_SESSION_ID"
  printf 'manual' > "$TOPICS_DIR/.source-$TEST_SESSION_ID"

  local hook_input='{"session_id": "'$TEST_SESSION_ID'", "transcript_path": "", "prompt": "Some new direction completely different"}'
  run bash "$PROJECT_ROOT/scripts/user-prompt-hook.sh" <<< "$hook_input"

  [ "$status" -eq 0 ]
  [[ "$(cat "$TOPICS_DIR/$TEST_SESSION_ID")" == "Locked Topic" ]]

  rm -f "$TOPICS_DIR/.manual-set-$TEST_SESSION_ID" "$TOPICS_DIR/.source-$TEST_SESSION_ID" "$TOPICS_DIR/.turns-$TEST_SESSION_ID"
}

@test "test_user_prompt_hook_skip_env" {
  local hook_input='{"session_id": "'$TEST_SESSION_ID'", "transcript_path": "", "prompt": "anything"}'
  CLAUDE_SESSION_TOPICS_SKIP=1 run bash "$PROJECT_ROOT/scripts/user-prompt-hook.sh" <<< "$hook_input"

  [ "$status" -eq 0 ]
  [ ! -f "$TOPICS_DIR/$TEST_SESSION_ID" ]
}

@test "test_hook_truncates_long_titles" {
  local tmpfile="$BATS_TEST_TMPDIR/transcript.jsonl"
  echo '{"type": "custom-title", "customTitle": "this-is-a-very-long-title-that-should-be-truncated-to-fifty-characters-maximum", "sessionId": "'$TEST_SESSION_ID'"}' > "$tmpfile"

  local hook_input='{"session_id": "'$TEST_SESSION_ID'", "transcript_path": "'$tmpfile'"}'
  run bash "$PROJECT_ROOT/scripts/auto-topic-hook.sh" <<< "$hook_input"

  [ "$status" -eq 0 ]

  local topic_content
  topic_content=$(cat "$TOPICS_DIR/$TEST_SESSION_ID")
  [ ${#topic_content} -le 50 ]
}

@test "test_statusline_reads_topic" {
  echo "Test Topic" > "$TOPICS_DIR/$TEST_SESSION_ID"

  local statusline_input='{"session_id": "'$TEST_SESSION_ID'"}'
  run bash "$PROJECT_ROOT/scripts/statusline.sh" <<< "$statusline_input"

  [ "$status" -eq 0 ]
  [[ "$output" == *"◆ Test Topic"* ]]
}

@test "test_statusline_reads_custom_title_fallback" {
  # No topic file exists, but transcript has custom-title
  local tmpfile="$BATS_TEST_TMPDIR/transcript.jsonl"
  echo '{"type": "custom-title", "customTitle": "add-search-filter", "sessionId": "'$TEST_SESSION_ID'"}' > "$tmpfile"

  local statusline_input='{"session_id": "'$TEST_SESSION_ID'", "transcript_path": "'$tmpfile'"}'
  run bash "$PROJECT_ROOT/scripts/statusline.sh" <<< "$statusline_input"

  [ "$status" -eq 0 ]
  [[ "$output" == *"Add Search Filter"* ]]
}

@test "test_statusline_with_color" {
  echo "Colored Topic" > "$TOPICS_DIR/$TEST_SESSION_ID"
  echo "cyan" > "$TOPICS_DIR/.color-config"

  local statusline_input='{"session_id": "'$TEST_SESSION_ID'"}'
  run bash "$PROJECT_ROOT/scripts/statusline.sh" <<< "$statusline_input"

  [ "$status" -eq 0 ]
  [[ "$output" == *$'\033[36m'* ]] || [[ "$output" == *"[36m"* ]]
  [[ "$output" == *"◆ Colored Topic"* ]]
}

@test "test_hook_no_session_id_exits_cleanly" {
  local hook_input='{"session_id": "", "transcript_path": "/nonexistent"}'

  run bash "$PROJECT_ROOT/scripts/auto-topic-hook.sh" <<< "$hook_input"

  [ "$status" -eq 0 ]
}

@test "test_pid_detection" {
  local test_script="$TEST_DIR/test_pid.sh"
  cat > "$test_script" << 'EOF'
find_claude_pid() {
  local pid=$$
  while [ "$pid" != "1" ] && [ -n "$pid" ]; do
    local parent
    parent=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    [ -z "$parent" ] && break
    local comm
    comm=$(ps -o comm= -p "$parent" 2>/dev/null)
    case "$comm" in
      *claude*|*Claude*) echo "$parent"; return 0 ;;
    esac
    pid=$parent
  done
  echo ""
}
result=$(find_claude_pid)
exit 0
EOF

  run bash "$test_script"
  [ "$status" -eq 0 ]
}

@test "test_refine_uses_no_session_persistence" {
  # The headless `claude -p` title-generation run must not persist its own
  # transcript, or it shows up as an orphan session in the IDE list.
  run grep -q -- "--no-session-persistence" "$PROJECT_ROOT/scripts/user-prompt-hook.sh"
  [ "$status" -eq 0 ]
}

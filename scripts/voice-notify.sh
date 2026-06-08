#!/bin/bash

TOPIC="${1:-}"
DETECTED_LANG="${2:-}"
[[ -z "$TOPIC" ]] && exit 0

CONFIG_FILE="${HOME}/.claude/session-topics/.voice-config"
[[ ! -f "$CONFIG_FILE" ]] && exit 0

VOICE_ENABLED=0
VOICE_LANG="en"
VOICE_NAME=""
VOICE_TEMPLATE=""
VOICE_AUTO_LANG=1
VOICE_MUTED=0
VOICE_VOLUME=100

# shellcheck source=/dev/null
source "$CONFIG_FILE"

[[ "$VOICE_ENABLED" != "1" ]] && exit 0
[[ "$VOICE_MUTED" == "1" ]] && exit 0

# Sanitize volume to an integer 0–100 (default 100 on garbage).
[[ "$VOICE_VOLUME" =~ ^[0-9]+$ ]] || VOICE_VOLUME=100
(( VOICE_VOLUME > 100 )) && VOICE_VOLUME=100

# Determine effective language
if [ "${VOICE_AUTO_LANG:-1}" = "1" ] && [ -n "$DETECTED_LANG" ]; then
    EFFECTIVE_LANG="$DETECTED_LANG"
else
    EFFECTIVE_LANG="${VOICE_LANG:-en}"
fi

# Build message: explicit template overrides, otherwise localize by language.
# Keep this map in sync with MESSAGES in bin/voice-picker.js.
if [ -n "$VOICE_TEMPLATE" ]; then
    MESSAGE="${VOICE_TEMPLATE//\{topic\}/$TOPIC}"
else
    lang_lc=$(printf '%s' "$EFFECTIVE_LANG" | tr '[:upper:]' '[:lower:]')
    case "$lang_lc" in
        es*)            MESSAGE="Tarea terminada: $TOPIC" ;;
        pt*)            MESSAGE="Tarefa concluída: $TOPIC" ;;
        fr*)            MESSAGE="Tâche terminée : $TOPIC" ;;
        de*)            MESSAGE="Aufgabe erledigt: $TOPIC" ;;
        it*)            MESSAGE="Attività completata: $TOPIC" ;;
        nl*)            MESSAGE="Taak voltooid: $TOPIC" ;;
        ja*)            MESSAGE="タスク完了: $TOPIC" ;;
        ko*)            MESSAGE="작업 완료: $TOPIC" ;;
        ru*)            MESSAGE="Задача выполнена: $TOPIC" ;;
        zh*|cmn*|yue*)  MESSAGE="任务完成：$TOPIC" ;;
        *)              MESSAGE="Done: $TOPIC" ;;
    esac
fi

speak_macos() {
  # `say` has no volume flag; the embedded [[volm 0–1]] command sets it inline.
  local msg="$MESSAGE"
  if (( VOICE_VOLUME < 100 )); then
    local volm
    volm=$(awk "BEGIN{printf \"%.2f\", ${VOICE_VOLUME}/100}")
    msg="[[volm ${volm}]] ${MESSAGE}"
  fi
  if [[ -n "$VOICE_NAME" ]]; then
    say -v "$VOICE_NAME" "$msg" &
  else
    case "$EFFECTIVE_LANG" in
      es*) say -v "Mónica" "$msg" & ;;
      *)   say "$msg" & ;;
    esac
  fi
}

speak_linux() {
  local engine=""
  if command -v espeak-ng &>/dev/null; then
    engine="espeak-ng"
  elif command -v espeak &>/dev/null; then
    engine="espeak"
  fi
  if [[ -n "$engine" ]]; then
    # espeak amplitude is 0–200; map 0–100% → 0–200.
    local amp=$(( VOICE_VOLUME * 2 ))
    if [[ -n "$VOICE_NAME" ]]; then
      "$engine" -a "$amp" -v "$VOICE_NAME" "$MESSAGE" &
    else
      "$engine" -a "$amp" -v "$EFFECTIVE_LANG" "$MESSAGE" &
    fi
  elif command -v spd-say &>/dev/null; then
    # spd-say volume is −100..100; map 0–100% → −100..100.
    spd-say -i $(( VOICE_VOLUME * 2 - 100 )) "$MESSAGE" &
  fi
}

speak_windows() {
  local sel=""
  if [[ -n "$VOICE_NAME" ]]; then
    local name_esc=${VOICE_NAME//\'/\'\'}
    sel="\$s.SelectVoice('${name_esc}');"
  fi
  local msg_esc=${MESSAGE//\'/\'\'}
  powershell.exe -NoProfile -Command "
    Add-Type -AssemblyName System.Speech;
    \$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;
    \$s.Volume = ${VOICE_VOLUME};
    ${sel}
    \$s.Speak('${msg_esc}')
  " &
}

case "$(uname -s)" in
  Darwin)  speak_macos   ;;
  Linux)   speak_linux   ;;
  MINGW*|MSYS*|CYGWIN*) speak_windows ;;
esac

exit 0

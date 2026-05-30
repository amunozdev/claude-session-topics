# claude-session-topics

Session topics for Claude Code. Auto-detect and display a topic in the statusline, change anytime with `/set-topic`.

![Session topics demo](./assets/session-topics-demo.jpg)

## Install

```bash
npx @alexismunozdev/claude-session-topics
```

## With color

```bash
npx @alexismunozdev/claude-session-topics --color cyan
```

Supported colors: `red`, `green`, `yellow`, `blue`, `magenta` (default), `cyan`, `white`, `orange`, `grey`/`gray`. Raw ANSI codes are also accepted (e.g., `38;5;208`).

## Voice notifications

Get spoken alerts when Claude detects a new session topic — useful when multitasking across terminals.

```bash
npx @alexismunozdev/claude-session-topics --voice       # English default
npx @alexismunozdev/claude-session-topics --voice es    # Spanish fallback
```

The voice **automatically matches your conversation language**. If you write in Spanish, you'll hear *"Tarea terminada: Deploy Config"*. In English: *"Done: Deploy Config"*.

**Platforms supported:**

| Platform | Engine | Install needed? |
|----------|--------|----------------|
| macOS | `say` (native) | No |
| Linux | `espeak` / `espeak-ng` | `sudo apt install espeak` |
| Windows | PowerShell SAPI | No |

**Disable voice:**

```bash
npx @alexismunozdev/claude-session-topics --no-voice
```

**Customize** by editing `~/.claude/session-topics/.voice-config`:

| Variable | Default | Description |
|----------|---------|-------------|
| `VOICE_ENABLED` | `1` | Master on/off |
| `VOICE_AUTO_LANG` | `1` | Auto-detect language from conversation |
| `VOICE_LANG` | `en` | Fallback language when auto-detect is off |
| `VOICE_NAME` | *(empty)* | Specific voice (e.g., `Mónica`, `Jorge` on macOS) |
| `VOICE_TEMPLATE` | *(empty)* | Custom message template with `{topic}` placeholder |
| `VOICE_MUTED` | `0` | Temporary mute without disabling |

## What it does

- A `UserPromptSubmit` hook runs on every user message: it writes a fast bash heuristic immediately, then refines the topic asynchronously via `claude -p` headless
- Once Claude Code generates its internal `custom-title`, the Stop hook upgrades the topic to that higher-quality version
- `/set-topic` always wins — manual topics are protected for the rest of the session
- Shows the topic in the Claude Code statusline (`◆ Topic`)
- Composes with existing statusline plugins (doesn't overwrite)

Topic source precedence: `manual > custom-title > refined > heuristic > empty`.

## What the installer configures

1. Copies the statusline script to `~/.claude/session-topics/`
2. Installs the `UserPromptSubmit` hook (`user-prompt-hook.sh`) for live topic generation
3. Installs the `Stop` hook (`auto-topic-hook.sh`) that upgrades the topic from Claude Code's internal `custom-title`
4. Configures `statusLine` in `~/.claude/settings.json`
5. Adds bash permission for the scripts
6. Installs the `set-topic` skill to `~/.claude/skills/`
7. If you already have a statusline, creates a wrapper that shows both
8. Copies `voice-notify.sh` for optional voice alerts

## Requirements

- `jq`
- `bash`
- POSIX-compatible system (macOS, Linux)
- `espeak` (Linux only, for voice notifications)

## Customization

The default topic color is bold magenta. Three ways to change it:

- Re-run with `--color <name>`:
  ```bash
  npx @alexismunozdev/claude-session-topics --color cyan
  ```
- Edit the config file directly:
  ```bash
  echo "cyan" > ~/.claude/session-topics/.color-config
  ```
- Set the `CLAUDE_TOPIC_COLOR` environment variable:
  ```bash
  export CLAUDE_TOPIC_COLOR="cyan"
  ```

## Token usage

This package installs **one skill** (`set-topic`) and **two hooks** (`UserPromptSubmit`, `Stop`).

- The `UserPromptSubmit` hook writes a topic synchronously via a bash heuristic (zero model tokens) and then spawns a background `claude -p --model haiku` call to refine it (one short headless call per user message, rate-limited to once every 15 seconds and only re-run every 3 turns when the topic is already `refined`).
- The `Stop` hook reads Claude Code's internal `custom-title` from the transcript JSONL — pure `jq` + `awk`, no model tokens.
- The `set-topic` skill is a minimal stub used only when you invoke `/set-topic` explicitly.

There is no longer an `auto-topic` skill — its job is now done deterministically by the `UserPromptSubmit` hook, removing the dependency on the model deciding to invoke a skill.

## Usage

### Auto-topic (automatic)

On every user message, the `UserPromptSubmit` hook writes a heuristic topic instantly (visible in <200 ms) and then refines it in the background via `claude -p`. After Claude Code generates an internal `custom-title` (typically a few turns in, or after a plan mode), the `Stop` hook upgrades the topic to that higher-quality version.

### /set-topic (manual)

Change the topic at any time:

```
/set-topic Fix Login Bug
/set-topic API Redesign
```

## How it works

```
User submits a prompt
    |
UserPromptSubmit hook (user-prompt-hook.sh)
    ├─ writes a bash heuristic topic synchronously (≤200 ms)
    └─ forks claude -p --model haiku to refine the topic in background
    |
Claude responds → Stop hook (auto-topic-hook.sh)
    └─ if custom-title is present in transcript, upgrades the topic
    |
Statusline reads ~/.claude/session-topics/${SESSION_ID} → ◆ Topic
```

Source precedence: `manual > custom-title > refined > heuristic > empty`. Each transition is recorded in `~/.claude/session-topics/.source-${SESSION_ID}`.

`/set-topic` writes a `.manual-set-${SESSION_ID}` marker that prevents both hooks from overwriting the topic for the rest of the session.

## Troubleshooting

### Run Diagnostics

Check your installation:

```bash
~/.claude/session-topics/diagnose.sh
```

Or from the project directory:
```bash
./scripts/diagnose.sh
```

### Enable Debug Logging

Set the verbose environment variable:

```bash
export CLAUDE_SESSION_TOPICS_VERBOSE=1
# Then run your claude commands
```

Or use the --verbose flag with the installer:

```bash
npx @alexismunozdev/claude-session-topics --verbose
```

### View Debug Logs

Debug logs are stored in:

```bash
cat ~/.claude/session-topics/debug.log
```

Log levels (set via `CLAUDE_SESSION_TOPICS_LOG_LEVEL`):
- `0` = DEBUG (most verbose)
- `1` = INFO (default)
- `2` = WARN
- `3` = ERROR (least verbose)

### Common Issues

**Topic not appearing in statusline:**
1. Check that the hook is registered: `cat ~/.claude/settings.json | jq '.hooks'`
2. Verify permissions: `cat ~/.claude/settings.json | jq '.permissions'`
3. Check debug logs for errors

**Permission denied errors:**
1. Ensure scripts are executable: `chmod +x ~/.claude/session-topics/*.sh`
2. Check that Bash permission is in settings.json

## Uninstall

```bash
npx @alexismunozdev/claude-session-topics --uninstall
```

This also removes voice configuration (`~/.claude/session-topics/.voice-config`).

## License

MIT

# claude-session-topics

Session topics for Claude Code. Auto-detect and display a topic in the statusline, change anytime with `/set-topic`.

![Session topics demo](./assets/session-topics-demo.jpg)

## Install

```bash
npx @alexismunozdev/claude-session-topics
```

On an interactive terminal this opens the color picker (arrow keys + live preview); press `Esc` to keep the current color. Skip it with `--color <name>` or on non-interactive/CI runs.

## Usage

The topic is detected automatically and shown in the statusline (`◆ Topic`). To set it yourself:

```
/set-topic Fix Login Bug
```

A manual topic is protected for the rest of the session — it always wins over auto-detection.

## How it works

- A `UserPromptSubmit` hook writes a fast bash-heuristic topic instantly (visible in <200 ms), then refines it in the background with `claude -p --model haiku`.
- Once Claude Code generates its internal `custom-title`, the `Stop` hook upgrades the topic to that higher-quality version.
- Source precedence: `manual > custom-title > refined > heuristic`.

The installer adds one skill (`set-topic`), two hooks (`UserPromptSubmit`, `Stop`), and a statusline command — composing with any existing statusline instead of overwriting it.

**Token cost:** one short `claude -p --model haiku` call per message (rate-limited to once every ~15 s). Reading `custom-title` and `/set-topic` use zero model tokens.

## Voice notifications

Get a spoken alert when Claude detects a new topic — handy when multitasking across terminals.

```bash
npx @alexismunozdev/claude-session-topics --voice       # enable (English default)
npx @alexismunozdev/claude-session-topics --voice es    # Spanish fallback
```

The voice **automatically matches your conversation language**: write in Spanish and you'll hear *"Tarea terminada: Deploy Config"*; in English, *"Done: Deploy Config"*.

| Platform | Engine | Install needed? |
|----------|--------|----------------|
| macOS | `say` (native) | No |
| Linux | `espeak` / `espeak-ng` | `sudo apt install espeak` |
| Windows | PowerShell SAPI | No |

```bash
npx @alexismunozdev/claude-session-topics --volume       # set volume (interactive slider, 0–100)
npx @alexismunozdev/claude-session-topics --volume 60    # set directly
npx @alexismunozdev/claude-session-topics --no-voice     # disable
```

Advanced tweaks (specific voice, custom message template) live in `~/.claude/session-topics/.voice-config`.

## Customization

The topic is bold cyan by default. Supported colors: `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `orange`, `grey`/`gray`, `none`. Raw ANSI codes also work (e.g. `38;5;208`).

```bash
npx @alexismunozdev/claude-session-topics --color        # interactive picker with live preview
npx @alexismunozdev/claude-session-topics --color cyan   # set directly
npx @alexismunozdev/claude-session-topics --options      # menu to review/change color, voice & volume
```

You can also set the color via `~/.claude/session-topics/.color-config` or the `CLAUDE_SESSION_TOPICS_COLOR` env var.

## Requirements

- `jq`, `bash`, and a POSIX-compatible system (macOS, Linux)
- `espeak` (Linux only, for voice notifications)

## Troubleshooting

Run diagnostics:

```bash
~/.claude/session-topics/diagnose.sh
```

For verbose logs, set `CLAUDE_SESSION_TOPICS_VERBOSE=1` and check `~/.claude/session-topics/debug.log`.

## Uninstall

```bash
npx @alexismunozdev/claude-session-topics --uninstall
```

Removes scripts, settings, and the skill (also the voice config); your topic data is preserved.

## License

MIT

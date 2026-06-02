# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.2.1] — 2026-06-01

### Fixed
- `--color gray` (American spelling) was rejected by the installer even though the statusline resolved it — `gray` is now an accepted named color alongside `grey`.
- Installer help and post-install summary still referenced the removed `auto-topic` skill and listed only the `Stop` hook. They now list just the `set-topic` skill and both hooks (`UserPromptSubmit` and `Stop`).
- Color picker accumulated repeated header/list copies on every arrow keypress in narrow terminals: it moved the cursor up by logical line count, but long lines wrapped to more visual rows, so stale rows were never cleared. Repaints now account for line wrap at the current terminal width.

### Changed
- Color picker now shows a single colored swatch per row (`◆ name`) instead of a duplicated plain label plus swatch — the live preview already reflects the highlighted color.

### Docs
- README documented a `--verbose` installer flag that does not exist; removed it (verbose logging is controlled via the `CLAUDE_SESSION_TOPICS_VERBOSE` env var).
- Removed duplicated color and topic-source-precedence sections; clarified that background refinement re-runs every 3 turns when `refined` and every 5 turns when `custom-title`.

## [5.2.0] — 2026-06-01

### Added
- Interactive color picker: run `npx @alexismunozdev/claude-session-topics --color` (no value) to choose the topic color with arrow keys and a live status-bar preview — `↑↓` to move, `Enter`/`Space` to choose, `Esc` to cancel. A fresh install also offers the picker when run in an interactive terminal (skipped on non-TTY/CI, and on upgrades where a color is already set). Pure Node, no new dependencies.

## [5.1.1] — 2026-06-01

### Changed
- Default topic color is now **cyan**, drawn from the ANSI palette so it adapts to light and dark terminal themes. The orange default (5.1.0) read like an error/warning — warm hues carry that meaning in a terminal, and it clashed with Claude Code's own orange `bypass permissions` indicator. Cyan is a cool, neutral hue with no error/warning/success connotation. Added a `none` named color (bold, no color) for a fully neutral look; the named `orange` reverts to its standard `38;5;208`.

## [5.1.0] — 2026-06-01

### Changed
- Default topic color is now Claude Code's orange (`#D97757`, truecolor `38;2;217;119;87`) instead of magenta. The named `orange` color was repurposed from the 256-color approximation (`38;5;208`) to the brand truecolor, so it doubles as the new default.

### Fixed
- README documented the color env var as `CLAUDE_TOPIC_COLOR`, but the statusline reads `CLAUDE_SESSION_TOPICS_COLOR`. Corrected the docs.

## [5.0.1] — 2026-05-28

### Fixed
- Background topic refinement never ran on macOS: the hook relied on `timeout` and `flock`, neither of which ships with macOS, so every session was stuck on the heuristic (first words of the prompt) and no session ever reached the `refined` source. Refinement now uses a portable `run_with_timeout` helper (`timeout`/`gtimeout` when present, pure-bash watchdog otherwise) and an atomic `mkdir`-based single-flight lock with stale-lock recovery.
- `claude -p` refinement returned conversational text instead of a topic. The instruction now lives in the message body with `--max-turns 1` (instead of `--append-system-prompt`), yielding a clean 2–5 word topic.

### Changed
- Heuristic placeholder is quieter: strips attachment markers (`[Image …]`) and a wider set of leading fillers (`bien`, `bueno`, `ahora`, `entonces`, `ok`, `dale`, …), drops bilingual acknowledgements (`si`, `sí`, `ok`, `dale`, `procedé`, …), and stays empty for a lone short word — waiting for the refinement rather than writing noise.

## [5.0.0] — 2026-04-13

### Added
- `UserPromptSubmit` hook (`scripts/user-prompt-hook.sh`) for deterministic topic generation on every user message — no longer dependent on the model invoking a skill
- Synchronous bash heuristic writes a topic in <200 ms; asynchronous `claude -p --model haiku` refines it in the background
- Explicit source tracking via `.source-${SESSION_ID}` marker (values: `manual`, `custom-title`, `refined`, `heuristic`)
- Manual override marker `.manual-set-${SESSION_ID}` — set by `/set-topic`, protects the topic from hook overwrites for the rest of the session
- Recursion guard `CLAUDE_SESSION_TOPICS_SKIP=1` so the background `claude -p` call does not re-trigger the hook

### Changed
- Stop hook (`auto-topic-hook.sh`) now upgrades existing topics when Claude Code's `custom-title` becomes available (previously it exited early if a topic already existed)
- Source precedence is now explicit: `manual > custom-title > refined > heuristic > empty`
- `set-topic` skill is self-contained (no longer delegates to `auto-topic`); sets the manual marker atomically
- Installer copies `scripts/lib/` and registers the new `UserPromptSubmit` hook; uninstall cleans both hooks
- README rewritten to describe the two-hook flow and precedence

### Removed
- `auto-topic` skill — its role is fully subsumed by the deterministic `UserPromptSubmit` hook, removing a source of non-determinism and race conditions. Installer removes the obsolete skill on upgrade.

### Breaking
- Installations that depended on the `auto-topic` skill being present should reinstall with `npx @alexismunozdev/claude-session-topics` to pick up the new hook registration.

## [4.0.0] — 2026-04-08

### Changed
- Topic extraction now reads Claude Code's internal `custom-title` from the transcript instead of using custom heuristics
- Simplified auto-topic skill — removed hook override logic, streamlined rules
- Simplified statusline fallback to use `custom-title` instead of bash heuristics

### Removed
- Removed `scripts/extract_topic.sh` (~320 lines of bash NLP heuristics)
- Removed `tests/integration/test_extract_topic.bats` and all transcript fixtures
- Removed topic extraction dependencies from installer (`extract_topic.sh` copy step)

## [3.4.0]

For previous changes, refer to the [git history](https://github.com/alexismunoz1/claude-session-topics/commits/main).

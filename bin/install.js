#!/usr/bin/env node

// claude-session-topics — npx installer
// Installs statusline script, skills, and configures settings.json
// Zero runtime dependency on npm after installation.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { runColorPicker } = require('./color-picker');

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const ok = (msg) => console.log(`  ${GREEN}\u2713${RESET} ${msg}`);
const warn = (msg) => console.log(`  ${YELLOW}\u26A0${RESET} ${msg}`);
const err = (msg) => console.error(`  ${RED}\u2717${RESET} ${msg}`);
const info = (msg) => console.log(`  ${DIM}${msg}${RESET}`);
const heading = (msg) => console.log(`\n${BOLD}${CYAN}${msg}${RESET}\n`);

// ─── Destination paths (fixed — never change) ───────────────────────────────

const HOME = os.homedir();
const TOPICS_DIR = path.join(HOME, '.claude', 'session-topics');
const DEST_STATUSLINE = path.join(TOPICS_DIR, 'statusline.sh');
const DEST_WRAPPER = path.join(TOPICS_DIR, 'wrapper-statusline.sh');
const DEST_HOOK_SCRIPT = path.join(TOPICS_DIR, 'auto-topic-hook.sh');
const DEST_PROMPT_HOOK = path.join(TOPICS_DIR, 'user-prompt-hook.sh');
const DEST_LIB_DIR = path.join(TOPICS_DIR, 'lib');
const ORIG_CMD_FILE = path.join(TOPICS_DIR, '.original-statusline-cmd');
const COLOR_CONFIG = path.join(TOPICS_DIR, '.color-config');
const DEST_VOICE_NOTIFY = path.join(TOPICS_DIR, 'voice-notify.sh');
const VOICE_CONFIG = path.join(TOPICS_DIR, '.voice-config');
const SKILLS_DIR = path.join(HOME, '.claude', 'skills');
const SETTINGS_FILE = path.join(HOME, '.claude', 'settings.json');

// ─── Source paths (relative to this script) ──────────────────────────────────

const SRC_STATUSLINE = path.join(__dirname, '..', 'scripts', 'statusline.sh');
const SRC_HOOK_SCRIPT = path.join(__dirname, '..', 'scripts', 'auto-topic-hook.sh');
const SRC_PROMPT_HOOK = path.join(__dirname, '..', 'scripts', 'user-prompt-hook.sh');
const SRC_LIB_DIR = path.join(__dirname, '..', 'scripts', 'lib');
const SRC_FIND_PID = path.join(__dirname, '..', 'scripts', 'find-claude-pid.sh');
const SRC_VOICE_NOTIFY = path.join(__dirname, '..', 'scripts', 'voice-notify.sh');
const SRC_SKILLS = path.join(__dirname, '..', 'skills');

// ─── The statusline command that settings.json will reference ────────────────

const STATUSLINE_CMD = `bash "/Users/mac/.claude/session-topics/statusline.sh"`;
const WRAPPER_CMD = `bash "/Users/mac/.claude/session-topics/wrapper-statusline.sh"`;
const STOP_HOOK_CMD = `bash "/Users/mac/.claude/session-topics/auto-topic-hook.sh" || true`;
const PROMPT_HOOK_CMD = `bash "/Users/mac/.claude/session-topics/user-prompt-hook.sh" || true`;

// ─── Permission rule ─────────────────────────────────────────────────────────

const PERMISSION_RULE = 'Bash(*/.claude/session-topics/*)';

// ─── Wrapper script content ──────────────────────────────────────────────────

const WRAPPER_SCRIPT = `#!/bin/bash
input=$(cat)
TOPIC_OUTPUT=$(echo "$input" | bash "$HOME/.claude/session-topics/statusline.sh" 2>/dev/null || echo "")
ORIG_CMD=$(cat "$HOME/.claude/session-topics/.original-statusline-cmd" 2>/dev/null || echo "")
ORIG_OUTPUT=""

# Validate the original command before executing it
validate_cmd() {
    local cmd="\$1"
    # Reject dangerous patterns: command substitution, backticks, chaining,
    # process substitution, and /dev/tcp|udp redirection
    if echo "\$cmd" | grep -qF '\$(' ; then return 1; fi
    if echo "\$cmd" | grep -qF '\`' ; then return 1; fi
    if echo "\$cmd" | grep -q '[;&|]' ; then return 1; fi
    if echo "\$cmd" | grep -qE '>\\(' ; then return 1; fi
    if echo "\$cmd" | grep -qE '<\\(' ; then return 1; fi
    if echo "\$cmd" | grep -qE '/dev/(tcp|udp)' ; then return 1; fi
    # Must start with an allowed command pattern (bash <path> or absolute path)
    if ! echo "\$cmd" | grep -qE '^(bash |/[a-zA-Z0-9._/-]+)' ; then return 1; fi
    return 0
}

if [ -n "$ORIG_CMD" ] && validate_cmd "$ORIG_CMD"; then
    ORIG_OUTPUT=$(echo "$input" | bash -c "$ORIG_CMD" 2>/dev/null || echo "")
fi

if [ -n "$TOPIC_OUTPUT" ] && [ -n "$ORIG_OUTPUT" ]; then
    echo -e "\${TOPIC_OUTPUT} | \${ORIG_OUTPUT}"
elif [ -n "$TOPIC_OUTPUT" ]; then
    echo -e "\${TOPIC_OUTPUT}"
elif [ -n "$ORIG_OUTPUT" ]; then
    echo -e "\${ORIG_OUTPUT}"
fi
`;

// ─── Utility functions ───────────────────────────────────────────────────────

function readSettings() {
    try {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function writeSettings(obj) {
    const dir = path.dirname(SETTINGS_FILE);
    fs.mkdirSync(dir, { recursive: true });
    // Atomic write: write to temp file then rename to avoid TOCTOU race condition
    const tmpFile = SETTINGS_FILE + '.tmp.' + process.pid;
    fs.writeFileSync(tmpFile, JSON.stringify(obj, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpFile, SETTINGS_FILE);
}

function copyDirRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function hasJq() {
    try {
        execSync('which jq', { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

// ─── CLI argument parsing ────────────────────────────────────────────────────

const VALID_NAMED_COLORS = ['green', 'blue', 'cyan', 'magenta', 'yellow', 'red', 'white', 'orange', 'grey', 'none'];
const VALID_ANSI_CODE_RE = /^[0-9;]{1,15}$/;

function validateColor(value) {
    if (VALID_NAMED_COLORS.includes(value.toLowerCase())) return true;
    if (VALID_ANSI_CODE_RE.test(value)) return true;
    return false;
}

function parseArgs(argv) {
    const args = argv.slice(2);
    const result = { action: 'install', color: null, voice: false, voiceLang: 'en', noVoice: false };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            result.action = 'help';
            return result;
        }
        if (arg === '--uninstall') {
            result.action = 'uninstall';
            return result;
        }
        if (arg === '--color') {
            const next = args[i + 1];
            // No value (or another flag next) → open the interactive picker.
            if (next === undefined || next.startsWith('--')) {
                result.action = 'color-picker';
                continue;
            }
            if (!validateColor(next)) {
                err(`Invalid color: "${next}". Use a named color (${VALID_NAMED_COLORS.join(', ')}) or a numeric ANSI code (max 15 chars).`);
                process.exit(1);
            }
            result.color = next;
            i++;
            continue;
        }
        if (arg === '--voice') {
            result.voice = true;
            if (i + 1 < args.length && /^[a-z]{2}(-[a-zA-Z]{2,})?$/.test(args[i + 1])) {
                result.voiceLang = args[i + 1];
                i++;
            }
            continue;
        }
        if (arg === '--no-voice') {
            result.noVoice = true;
            continue;
        }
    }

    return result;
}

// ─── Help ────────────────────────────────────────────────────────────────────

function showHelp() {
    console.log(`
${BOLD}claude-session-topics${RESET} — session topics for Claude Code

${BOLD}Usage:${RESET}
  npx @alexismunozdev/claude-session-topics            Install
  npx @alexismunozdev/claude-session-topics --color       Pick color interactively
  npx @alexismunozdev/claude-session-topics --color cyan  Install with color
  npx @alexismunozdev/claude-session-topics --uninstall   Uninstall

${BOLD}Options:${RESET}
  --color [name]   Set topic color (red, green, yellow, blue, magenta,
                    cyan, white, orange, grey, none). Default: cyan.
                    With no name, opens an interactive picker with a live
                    status-bar preview (↑↓ to move, Enter/Space to choose).
  --uninstall      Remove scripts, settings, and skills (preserves topic data)
  --voice [lang]   Enable voice notifications when topic is detected
                    (default lang: en). Example: --voice es
  --no-voice       Disable voice notifications
  -h, --help       Show this help

${BOLD}What it does:${RESET}
  - Copies statusline.sh to ~/.claude/session-topics/
  - Configures statusLine in ~/.claude/settings.json
  - Adds Bash permission for session-topics commands
  - Registers Stop hook for automatic topic detection
  - Installs auto-topic and set-topic skills to ~/.claude/skills/

${BOLD}After install:${RESET}
  The statusline shows the current topic automatically.
  Use ${CYAN}/set-topic <text>${RESET} to change it manually.
`);
}

// ─── Install ─────────────────────────────────────────────────────────────────

async function install(color, voice, voiceLang, noVoice) {
    heading('Installing claude-session-topics');

    // ── Step 1: Check deps ───────────────────────────────────────────────

    if (!hasJq()) {
        err('jq is required but not found in PATH.');
        console.log(`\n  Install it:  ${BOLD}brew install jq${RESET}  (macOS)`);
        console.log(`               ${BOLD}sudo apt install jq${RESET}  (Ubuntu/Debian)\n`);
        process.exit(1);
    }
    ok('jq found');

    // ── Step 2: Create dir ───────────────────────────────────────────────

    fs.mkdirSync(TOPICS_DIR, { recursive: true });
    ok(`Created ${DIM}~/.claude/session-topics/${RESET}`);

    // ── Step 3: Copy statusline ──────────────────────────────────────────

    if (!fs.existsSync(SRC_STATUSLINE)) {
        err(`Source statusline not found: ${SRC_STATUSLINE}`);
        process.exit(1);
    }
    fs.copyFileSync(SRC_STATUSLINE, DEST_STATUSLINE);
    fs.chmodSync(DEST_STATUSLINE, 0o755);
    ok('Copied statusline.sh');

    // ── Step 4: Copy auto-topic hook script ─────────────────────────────

    if (!fs.existsSync(SRC_HOOK_SCRIPT)) {
        err(`Source hook script not found: ${SRC_HOOK_SCRIPT}`);
        process.exit(1);
    }
    fs.copyFileSync(SRC_HOOK_SCRIPT, DEST_HOOK_SCRIPT);
    fs.chmodSync(DEST_HOOK_SCRIPT, 0o755);
    ok('Copied auto-topic-hook.sh');

    // ── Step 4a: Copy user-prompt-hook + lib ────────────────────────────
    if (!fs.existsSync(SRC_PROMPT_HOOK)) {
        err(`Source prompt hook not found: ${SRC_PROMPT_HOOK}`);
        process.exit(1);
    }
    fs.copyFileSync(SRC_PROMPT_HOOK, DEST_PROMPT_HOOK);
    fs.chmodSync(DEST_PROMPT_HOOK, 0o755);
    ok('Copied user-prompt-hook.sh');

    if (fs.existsSync(SRC_LIB_DIR)) {
        copyDirRecursive(SRC_LIB_DIR, DEST_LIB_DIR);
        ok('Copied scripts/lib/');
    }

    // ── Step 4b: Copy find-claude-pid.sh (belt-and-suspenders) ──────────

    const DEST_FIND_PID = path.join(TOPICS_DIR, 'find-claude-pid.sh');
    if (fs.existsSync(SRC_FIND_PID)) {
        fs.copyFileSync(SRC_FIND_PID, DEST_FIND_PID);
        fs.chmodSync(DEST_FIND_PID, 0o755);
        ok('Copied find-claude-pid.sh');
    } else {
        info('find-claude-pid.sh not found in source (not required — PID lookup is inlined)');
    }

    // Always copy voice-notify.sh (available if user enables later)
    if (fs.existsSync(SRC_VOICE_NOTIFY)) {
        fs.copyFileSync(SRC_VOICE_NOTIFY, DEST_VOICE_NOTIFY);
        fs.chmodSync(DEST_VOICE_NOTIFY, 0o755);
        ok('Copied voice-notify.sh');
    }

    // ── Step 5: Configure statusline in settings.json ────────────────────

    const settings = readSettings();
    const statusLineCase = determineStatusLineCase(settings);

    switch (statusLineCase) {
        case 'A': {
            // No statusLine — create fresh
            settings.statusLine = {
                type: 'command',
                command: STATUSLINE_CMD,
            };
            writeSettings(settings);
            ok('Configured statusLine in settings.json');
            break;
        }
        case 'B': {
            // Already ours — scripts already updated above
            // Migrate from wrapper to direct statusline if needed
            if (settings.statusLine.command === WRAPPER_CMD) {
                settings.statusLine.command = STATUSLINE_CMD;
                writeSettings(settings);
                info('Migrated from wrapper to direct statusline');
            }
            ok('statusLine already configured for session-topics (updated script)');
            break;
        }
        case 'C': {
            // Another command exists — back it up, statusline.sh will run it
            const origCmd = settings.statusLine.command;

            try { fs.unlinkSync(ORIG_CMD_FILE); } catch {}
            fs.writeFileSync(ORIG_CMD_FILE, origCmd, { encoding: 'utf8', mode: 0o400 });
            info(`Backed up original statusLine command to .original-statusline-cmd`);

            settings.statusLine.command = STATUSLINE_CMD;
            writeSettings(settings);
            ok('Configured statusLine (your existing statusline is preserved and runs alongside)');
            break;
        }
        case 'D': {
            // statusLine exists but no valid command
            settings.statusLine.command = STATUSLINE_CMD;
            writeSettings(settings);
            ok('Configured statusLine command (existing statusLine had no command)');
            break;
        }
    }

    // ── Step 6: Add permission ───────────────────────────────────────────

    if (!settings.permissions || typeof settings.permissions !== 'object' || Array.isArray(settings.permissions)) {
        settings.permissions = {};
    }
    if (!Array.isArray(settings.permissions.allow)) {
        settings.permissions.allow = [];
    }
    if (!settings.permissions.allow.includes(PERMISSION_RULE)) {
        settings.permissions.allow.push(PERMISSION_RULE);
        writeSettings(settings);
        ok(`Added permission: ${DIM}${PERMISSION_RULE}${RESET}`);
    } else {
        ok('Permission already present');
    }

    // ── Step 7: Register Stop hook ──────────────────────────────────────

    if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
        settings.hooks = {};
    }
    if (!Array.isArray(settings.hooks.Stop)) {
        settings.hooks.Stop = [];
    }

    // Find existing session-topics hook entry
    let hookFound = false;
    for (const entry of settings.hooks.Stop) {
        if (entry && Array.isArray(entry.hooks)) {
            for (const h of entry.hooks) {
                if (h && typeof h.command === 'string' && h.command.includes('session-topics')) {
                    h.command = STOP_HOOK_CMD;
                    hookFound = true;
                }
            }
        }
    }

    if (!hookFound) {
        settings.hooks.Stop.push({
            hooks: [
                {
                    type: 'command',
                    command: STOP_HOOK_CMD,
                },
            ],
        });
    }
    writeSettings(settings);
    if (hookFound) {
        ok('Updated Stop hook for auto-topic detection');
    } else {
        ok('Registered Stop hook for auto-topic detection');
    }

    // ── Step 7b: Register UserPromptSubmit hook ─────────────────────────

    if (!Array.isArray(settings.hooks.UserPromptSubmit)) {
        settings.hooks.UserPromptSubmit = [];
    }
    let promptHookFound = false;
    for (const entry of settings.hooks.UserPromptSubmit) {
        if (entry && Array.isArray(entry.hooks)) {
            for (const h of entry.hooks) {
                if (h && typeof h.command === 'string' && h.command.includes('session-topics')) {
                    h.command = PROMPT_HOOK_CMD;
                    promptHookFound = true;
                }
            }
        }
    }
    if (!promptHookFound) {
        settings.hooks.UserPromptSubmit.push({
            hooks: [{ type: 'command', command: PROMPT_HOOK_CMD }],
        });
    }
    writeSettings(settings);
    if (promptHookFound) {
        ok('Updated UserPromptSubmit hook for live topic generation');
    } else {
        ok('Registered UserPromptSubmit hook for live topic generation');
    }

    // ── Step 7c: Remove obsolete auto-topic skill from previous installs ─
    const obsoleteAutoTopic = path.join(SKILLS_DIR, 'auto-topic');
    if (fs.existsSync(obsoleteAutoTopic)) {
        fs.rmSync(obsoleteAutoTopic, { recursive: true, force: true });
        info('Removed obsolete auto-topic skill (replaced by UserPromptSubmit hook)');
    }

    // ── Step 8: Copy skills ──────────────────────────────────────────────

    const skillsToCopy = ['set-topic'];
    for (const skill of skillsToCopy) {
        const srcSkill = path.join(SRC_SKILLS, skill);
        const destSkill = path.join(SKILLS_DIR, skill);
        if (fs.existsSync(srcSkill)) {
            copyDirRecursive(srcSkill, destSkill);
            ok(`Installed skill: ${BOLD}${skill}${RESET}`);
        } else {
            warn(`Skill source not found: ${skill}`);
        }
    }

    if (color) {
        fs.writeFileSync(COLOR_CONFIG, color, { encoding: 'utf8', mode: 0o600 });
        ok(`Topic color set to: ${BOLD}${color}${RESET}`);
    }

    // Voice config (only when --voice flag used)
    if (voice) {
        const configContent = [
            '# Voice notification config for claude-session-topics',
            'VOICE_ENABLED=1',
            `VOICE_LANG=${voiceLang}`,
            'VOICE_NAME=',
            'VOICE_TEMPLATE=',
            'VOICE_AUTO_LANG=1',
            'VOICE_MUTED=0',
        ].join('\n') + '\n';
        fs.writeFileSync(VOICE_CONFIG, configContent, { encoding: 'utf8', mode: 0o644 });
        ok(`Voice notifications enabled (language: ${voiceLang})`);
    }

    // Disable voice (remove config file)
    if (noVoice) {
        if (fs.existsSync(VOICE_CONFIG)) {
            fs.unlinkSync(VOICE_CONFIG);
            ok('Voice notifications disabled');
        } else {
            info('Voice notifications were not enabled');
        }
    }

    // ── Step 9.5: Offer the interactive color picker on first install ────
    // Only when no --color was given, we're on a TTY, and no color is set yet
    // (so upgrades don't re-prompt). Cancelling keeps the default (cyan).
    if (!color && process.stdin.isTTY && !fs.existsSync(COLOR_CONFIG)) {
        console.log('');
        const chosen = await runColorPicker({ initial: 'cyan', project: path.basename(process.cwd()) });
        if (chosen) {
            fs.writeFileSync(COLOR_CONFIG, chosen, { encoding: 'utf8', mode: 0o600 });
            ok(`Topic color set to: ${BOLD}${chosen}${RESET}`);
            color = chosen;
        }
    }

    // ── Step 10: Summary ─────────────────────────────────────────────────

    console.log('');
    heading('Installation complete');
    console.log(`  ${DIM}Statusline:${RESET}  ~/.claude/session-topics/statusline.sh`);
    console.log(`  ${DIM}Skills:${RESET}      ~/.claude/skills/auto-topic/`);
    console.log(`                ~/.claude/skills/set-topic/`);
    console.log(`  ${DIM}Hook:${RESET}        Stop → auto-topic-hook.sh`);
    console.log(`  ${DIM}Settings:${RESET}    ~/.claude/settings.json`);
    if (color) {
        console.log(`  ${DIM}Color:${RESET}       ${color}`);
    }
    console.log('');
    console.log(`  Topics are set automatically. Use ${CYAN}/set-topic <text>${RESET} to override.`);
    console.log('');
}

function determineStatusLineCase(settings) {
    // Case B or C: statusLine exists
    if (settings.statusLine && typeof settings.statusLine === 'object') {
        const cmd = settings.statusLine.command;
        if (typeof cmd === 'string' && cmd.length > 0) {
            // Case B: already ours
            if (cmd.includes('session-topics')) {
                return 'B';
            }
            // Case C: another command
            return 'C';
        }
        // statusLine exists but no valid command
        return 'D';
    }
    // No statusLine at all
    return 'A';
}

// ─── Uninstall ───────────────────────────────────────────────────────────────

function uninstall() {
    heading('Uninstalling claude-session-topics');

    const settings = readSettings();

    // ── Step 1: Restore statusline ───────────────────────────────────────

    if (fs.existsSync(ORIG_CMD_FILE)) {
        // Had a previous command — restore it
        const origCmd = fs.readFileSync(ORIG_CMD_FILE, 'utf8').trim();
        if (origCmd && settings.statusLine) {
            settings.statusLine.command = origCmd;
            writeSettings(settings);
            ok(`Restored original statusLine command`);
            info(`  ${origCmd}`);
        }
    } else {
        // No backup — remove statusLine entirely if it's ours
        if (
            settings.statusLine &&
            typeof settings.statusLine.command === 'string' &&
            settings.statusLine.command.includes('session-topics')
        ) {
            delete settings.statusLine;
            writeSettings(settings);
            ok('Removed statusLine from settings.json');
        } else if (settings.statusLine) {
            info('statusLine does not reference session-topics — left untouched');
        } else {
            info('No statusLine to remove');
        }
    }

    // ── Step 2: Delete scripts ───────────────────────────────────────────

    const DEST_FIND_PID = path.join(TOPICS_DIR, 'find-claude-pid.sh');
    const filesToDelete = [DEST_STATUSLINE, DEST_WRAPPER, DEST_HOOK_SCRIPT, DEST_PROMPT_HOOK, DEST_FIND_PID, ORIG_CMD_FILE, DEST_VOICE_NOTIFY, VOICE_CONFIG];
    for (const file of filesToDelete) {
        if (fs.existsSync(file)) {
            fs.unlinkSync(file);
            ok(`Deleted ${path.basename(file)}`);
        }
    }
    if (fs.existsSync(DEST_LIB_DIR)) {
        fs.rmSync(DEST_LIB_DIR, { recursive: true, force: true });
        ok('Deleted lib/');
    }

    // ── Step 3: Remove permission ────────────────────────────────────────

    if (
        settings.permissions &&
        typeof settings.permissions === 'object' &&
        Array.isArray(settings.permissions.allow)
    ) {
        const before = settings.permissions.allow.length;
        const OLD_PERMISSION_RULE = 'Bash(*session-topics*)';
        settings.permissions.allow = settings.permissions.allow.filter(
            (rule) => rule !== PERMISSION_RULE && rule !== OLD_PERMISSION_RULE,
        );
        if (settings.permissions.allow.length < before) {
            writeSettings(settings);
            ok(`Removed permission: ${PERMISSION_RULE}`);
        }
    }

    // ── Step 4: Remove hooks (Stop + UserPromptSubmit) ──────────────────

    if (settings.hooks && typeof settings.hooks === 'object') {
        for (const eventName of ['Stop', 'UserPromptSubmit']) {
            if (!Array.isArray(settings.hooks[eventName])) continue;
            const beforeLen = settings.hooks[eventName].length;
            settings.hooks[eventName] = settings.hooks[eventName].filter((entry) => {
                if (entry && Array.isArray(entry.hooks)) {
                    return !entry.hooks.some(
                        (h) => h && typeof h.command === 'string' && h.command.includes('session-topics'),
                    );
                }
                return true;
            });
            if (settings.hooks[eventName].length < beforeLen) {
                if (settings.hooks[eventName].length === 0) {
                    delete settings.hooks[eventName];
                }
                ok(`Removed ${eventName} hook`);
            }
        }
        if (Object.keys(settings.hooks).length === 0) {
            delete settings.hooks;
        }
        writeSettings(settings);
    }

    // ── Step 5: Delete skills ────────────────────────────────────────────

    const skillsToDelete = ['auto-topic', 'set-topic'];
    for (const skill of skillsToDelete) {
        const skillDir = path.join(SKILLS_DIR, skill);
        if (fs.existsSync(skillDir)) {
            fs.rmSync(skillDir, { recursive: true, force: true });
            ok(`Removed skill: ${skill}`);
        }
    }

    // ── Step 6: Preserve data ────────────────────────────────────────────

    info('Preserved topic data in ~/.claude/session-topics/ (topic files + color config)');

    // ── Summary ──────────────────────────────────────────────────────────

    console.log('');
    heading('Uninstall complete');
    console.log(`  Scripts and skills removed. Topic data preserved.`);
    console.log(`  To fully remove all data: ${DIM}rm -rf ~/.claude/session-topics/${RESET}`);
    console.log('');
}

// ─── Main ────────────────────────────────────────────────────────────────────

// Read the currently configured color (or null) for use as the picker default.
function readCurrentColor() {
    try {
        const c = fs.readFileSync(COLOR_CONFIG, 'utf8').trim();
        return c || null;
    } catch {
        return null;
    }
}

async function pickAndSaveColor() {
    if (!process.stdin.isTTY) {
        info('No interactive terminal — run with a value, e.g. --color cyan');
        return;
    }
    const chosen = await runColorPicker({
        initial: readCurrentColor() || 'cyan',
        project: path.basename(process.cwd()),
    });
    if (chosen) {
        fs.writeFileSync(COLOR_CONFIG, chosen, { encoding: 'utf8', mode: 0o600 });
        ok(`Topic color set to: ${BOLD}${chosen}${RESET}`);
        info('Open a new session (or run /set-topic) to see it.');
    } else {
        info('No change — kept the current color.');
    }
}

async function main() {
    const { action, color, voice, voiceLang, noVoice } = parseArgs(process.argv);

    switch (action) {
        case 'help':
            showHelp();
            break;
        case 'install':
            await install(color, voice, voiceLang, noVoice);
            break;
        case 'color-picker':
            await pickAndSaveColor();
            break;
        case 'uninstall':
            uninstall();
            break;
        default:
            showHelp();
            break;
    }
}

if (require.main === module) {
    main();
}

// Export functions for testing
module.exports = {
    validateColor,
    parseArgs,
    determineStatusLineCase,
    ...require('./color-picker'),
};

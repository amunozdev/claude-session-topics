'use strict';

// Interactive volume picker for the finish-task announcement — pure Node, zero deps.
// Slider style: ↑↓ adjust the level in 10% steps (0–100); moving the slider plays
// the current voice at the new level so the user can hear it. Pure pieces
// (clampVolume, reduceKey, volumeToBar, renderPicker) are unit-tested;
// runVolumePicker isolates the TTY + audio side effects.

const { visualRowCount } = require('./color-picker');
const { speak } = require('./voice-picker');

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const STEP = 10; // each keypress moves the slider one notch
const BARS = 10; // total notches in the rendered bar (0–100 → 10 blocks)

// Snap an arbitrary number to a valid slider value (0–100, multiples of STEP). Pure.
function clampVolume(n) {
    let v = Math.round(Number(n) / STEP) * STEP;
    if (!Number.isFinite(v)) v = 100;
    if (v < 0) v = 0;
    if (v > 100) v = 100;
    return v;
}

// Reduce a keypress into a new volume + an action. Pure.
// action ∈ 'move' | 'select' | 'cancel' | 'none'
function reduceKey(state, key) {
    const { volume } = state;
    switch (key) {
        case '\x1b[A': // up arrow
        case '\x1b[C': // right arrow
        case 'k':
        case 'l':
            return { volume: clampVolume(volume + STEP), action: 'move' };
        case '\x1b[B': // down arrow
        case '\x1b[D': // left arrow
        case 'j':
        case 'h':
            return { volume: clampVolume(volume - STEP), action: 'move' };
        case '\r': // enter
        case '\n':
        case ' ': // space
            return { volume, action: 'select' };
        case '\x1b': // lone escape
        case '\x03': // ctrl-c
            return { volume, action: 'cancel' };
        default:
            return { volume, action: 'none' };
    }
}

// Render the slider bar for a volume, e.g. 70 → "[#######---]". Pure.
function volumeToBar(volume) {
    const filled = Math.round(clampVolume(volume) / (100 / BARS));
    return `[${'#'.repeat(filled)}${'-'.repeat(BARS - filled)}]`;
}

// Render the full picker screen for a given state. Pure → returns a string.
function renderPicker(state) {
    const volume = clampVolume(state.volume);
    const lines = [];
    lines.push(`${BOLD}Choose the voice volume${RESET}  ${DIM}(↑↓ adjust · Enter/Space select · Esc cancel)${RESET}`);
    lines.push('');
    lines.push(`   ${BOLD}Volume: ${volume}%${RESET}`);
    lines.push(`   ${volume === 0 ? DIM : ''}${volumeToBar(volume)}${RESET}`);
    lines.push('');
    lines.push(` ${DIM}Preview:${RESET}  ${DIM}plays the current voice at this level — ↑↓ to hear${RESET}`);
    return lines.join('\n');
}

// Side-effecting runner. Resolves the chosen volume (0–100), or null if cancelled
// / no TTY. Moving the slider plays `voiceEntry` at the current level via speak().
// input/output/speak are injectable for tests.
function runVolumePicker(opts = {}) {
    const input = opts.input || process.stdin;
    const output = opts.output || process.stdout;

    if (!input.isTTY) {
        return Promise.resolve(null);
    }

    const speakFn = opts.speak || speak;
    const voiceEntry = opts.voiceEntry || { id: '', lang: '' };
    let volume = clampVolume(opts.initial == null ? 100 : opts.initial);

    const HIDE_CURSOR = '\x1b[?25l';
    const SHOW_CURSOR = '\x1b[?25h';

    return new Promise((resolve) => {
        let lastLineCount = 0;
        let lastChild = null;

        const killAudio = () => {
            if (lastChild && lastChild.kill) {
                try { lastChild.kill(); } catch { /* already gone */ }
            }
        };

        const draw = () => {
            if (lastLineCount > 0) {
                output.write(`\x1b[${lastLineCount}A\x1b[J`); // move up + clear to end of screen
            }
            const screen = renderPicker({ volume });
            output.write(screen + '\n');
            lastLineCount = visualRowCount(screen, output.columns);
        };

        const preview = () => {
            killAudio();
            lastChild = speakFn(voiceEntry, { volume });
        };

        const cleanup = () => {
            input.removeListener('data', onData);
            if (input.setRawMode) input.setRawMode(false);
            input.pause();
            output.write(SHOW_CURSOR);
            killAudio();
        };

        const onData = (chunk) => {
            const key = chunk.toString();
            const next = reduceKey({ volume }, key);
            volume = next.volume;
            if (next.action === 'select') {
                cleanup();
                resolve(volume);
            } else if (next.action === 'cancel') {
                cleanup();
                resolve(null);
            } else if (next.action === 'move') {
                draw();
                preview();
            }
        };

        if (input.setRawMode) input.setRawMode(true);
        input.resume();
        output.write(HIDE_CURSOR);
        draw();
        input.on('data', onData);
    });
}

module.exports = { clampVolume, reduceKey, volumeToBar, renderPicker, runVolumePicker };

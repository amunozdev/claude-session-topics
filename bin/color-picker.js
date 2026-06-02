'use strict';

// Interactive color picker for the session topic — pure Node, zero deps.
// Pure pieces (COLORS, renderPicker, reduceKey) are unit-tested; runColorPicker
// isolates the TTY/raw-mode side effects and accepts injectable input/output.

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// Mirrors resolve_color() in scripts/statusline.sh — keep in sync.
// `none` renders bold with no color (terminal foreground).
const COLORS = [
    { name: 'cyan', ansi: '\x1b[36m' },
    { name: 'green', ansi: '\x1b[32m' },
    { name: 'blue', ansi: '\x1b[34m' },
    { name: 'magenta', ansi: '\x1b[35m' },
    { name: 'yellow', ansi: '\x1b[33m' },
    { name: 'red', ansi: '\x1b[31m' },
    { name: 'white', ansi: '\x1b[37m' },
    { name: 'orange', ansi: '\x1b[38;5;208m' },
    { name: 'grey', ansi: '\x1b[90m' },
    { name: 'none', ansi: '' },
];

// Reduce a keypress into a new index + an action. Pure.
// action ∈ 'move' | 'select' | 'cancel' | 'none'
function reduceKey(state, key) {
    const count = COLORS.length;
    const { index } = state;
    switch (key) {
        case '\x1b[A': // up arrow
        case 'k':
            return { index: (index - 1 + count) % count, action: 'move' };
        case '\x1b[B': // down arrow
        case 'j':
            return { index: (index + 1) % count, action: 'move' };
        case '\r': // enter
        case '\n':
        case ' ': // space
            return { index, action: 'select' };
        case '\x1b': // lone escape
        case '\x03': // ctrl-c
            return { index, action: 'cancel' };
        default:
            return { index, action: 'none' };
    }
}

// Count the visual rows a rendered screen occupies, accounting for line wrap
// at the given terminal width. Logical lines wider than `cols` wrap to multiple
// rows; miscounting these leaves stale rows that accumulate on each repaint. Pure.
function visualRowCount(screen, cols) {
    const width = cols > 0 ? cols : 80;
    const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    return screen.split('\n').reduce((sum, line) => {
        return sum + Math.max(1, Math.ceil(stripAnsi(line).length / width));
    }, 0);
}

// Render the full picker screen for a given state. Pure → returns a string.
function renderPicker(state) {
    const { index, sampleTopic = 'Deploy auth', model = 'Opus 4.8', project = 'my-project' } = state;
    const lines = [];
    lines.push(`${BOLD}Choose the topic color${RESET}  ${DIM}(↑↓ move · Enter/Space select · Esc cancel)${RESET}`);
    lines.push('');
    for (let i = 0; i < COLORS.length; i++) {
        const { name, ansi } = COLORS[i];
        const pointer = i === index ? '❱' : ' ';
        const swatch = `${BOLD}${ansi}◆ ${name}${RESET}`;
        lines.push(` ${pointer} ${swatch}`);
    }
    const { ansi } = COLORS[index];
    lines.push('');
    lines.push(` ${DIM}Preview:${RESET}`);
    lines.push(`   ${BOLD}${ansi}◆ ${sampleTopic}${RESET}  ${DIM}│${RESET}  ${model}  ${DIM}│${RESET}  ${project} ${DIM}(main)${RESET}`);
    return lines.join('\n');
}

// Side-effecting runner. Resolves the chosen color name, or null if cancelled
// or no TTY. input/output are injectable for testing.
function runColorPicker(opts = {}) {
    const input = opts.input || process.stdin;
    const output = opts.output || process.stdout;
    const sampleTopic = opts.sampleTopic || 'Deploy auth';
    const model = opts.model || 'Opus 4.8';
    const project = opts.project || 'my-project';

    if (!input.isTTY) {
        return Promise.resolve(null);
    }

    let index = COLORS.findIndex((c) => c.name === opts.initial);
    if (index < 0) index = 0;

    const HIDE_CURSOR = '\x1b[?25l';
    const SHOW_CURSOR = '\x1b[?25h';

    return new Promise((resolve) => {
        let lastLineCount = 0;

        const draw = () => {
            if (lastLineCount > 0) {
                output.write(`\x1b[${lastLineCount}A\x1b[J`); // move up + clear to end of screen
            }
            const screen = renderPicker({ index, sampleTopic, model, project });
            output.write(screen + '\n');
            lastLineCount = visualRowCount(screen, output.columns);
        };

        const cleanup = () => {
            input.removeListener('data', onData);
            if (input.setRawMode) input.setRawMode(false);
            input.pause();
            output.write(SHOW_CURSOR);
        };

        const onData = (chunk) => {
            const key = chunk.toString();
            const next = reduceKey({ index }, key);
            index = next.index;
            if (next.action === 'select') {
                cleanup();
                resolve(COLORS[index].name);
            } else if (next.action === 'cancel') {
                cleanup();
                resolve(null);
            } else if (next.action === 'move') {
                draw();
            }
        };

        if (input.setRawMode) input.setRawMode(true);
        input.resume();
        output.write(HIDE_CURSOR);
        draw();
        input.on('data', onData);
    });
}

module.exports = { COLORS, reduceKey, renderPicker, visualRowCount, runColorPicker };

'use strict';

// Interactive options menu for the CLI — pure Node, zero deps. Shows the current
// settings (color, voice, volume) and lets the user pick which one to reconfigure;
// install.js launches the matching picker and re-renders. Pure pieces (MENU_ITEMS,
// reduceKey, renderMenu) are unit-tested; runOptionsMenu isolates the TTY effects.

const { visualRowCount } = require('./color-picker');

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// Each item resolves to the action install.js dispatches on (or null for quit).
const MENU_ITEMS = [
    { action: 'color', label: 'Color' },
    { action: 'voice', label: 'Voice' },
    { action: 'volume', label: 'Volume' },
    { action: null, label: 'Quit' },
];

// Reduce a keypress into a new index + an action. Pure.
// action ∈ 'move' | 'select' | 'cancel' | 'none'
function reduceKey(state, key) {
    const count = MENU_ITEMS.length;
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

// Render the menu for a given state. Pure → returns a string.
// `settings` = { color, voiceLabel, volume } shown above the choices.
function renderMenu(state) {
    const { index, settings = {} } = state;
    const { color = 'cyan', voiceLabel = 'Off', volume = 100 } = settings;
    const lines = [];
    lines.push(`${BOLD}Current settings${RESET}`);
    lines.push(`  ${DIM}Color:${RESET}   ${color}`);
    lines.push(`  ${DIM}Voice:${RESET}   ${voiceLabel}`);
    lines.push(`  ${DIM}Volume:${RESET}  ${volume}%`);
    lines.push('');
    lines.push(`${BOLD}What do you want to change?${RESET}  ${DIM}(↑↓ move · Enter/Space select · Esc quit)${RESET}`);
    for (let i = 0; i < MENU_ITEMS.length; i++) {
        const pointer = i === index ? '❱' : ' ';
        lines.push(` ${pointer} ${MENU_ITEMS[i].label}`);
    }
    return lines.join('\n');
}

// Side-effecting runner. Resolves the chosen action ('color' | 'voice' | 'volume')
// or null when the user quits / cancels / no TTY. input/output injectable for tests.
function runOptionsMenu(opts = {}) {
    const input = opts.input || process.stdin;
    const output = opts.output || process.stdout;
    const settings = opts.settings || {};

    if (!input.isTTY) {
        return Promise.resolve(null);
    }

    let index = 0;

    const HIDE_CURSOR = '\x1b[?25l';
    const SHOW_CURSOR = '\x1b[?25h';

    return new Promise((resolve) => {
        let lastLineCount = 0;

        const draw = () => {
            if (lastLineCount > 0) {
                output.write(`\x1b[${lastLineCount}A\x1b[J`); // move up + clear to end of screen
            }
            const screen = renderMenu({ index, settings });
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
                resolve(MENU_ITEMS[index].action);
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

module.exports = { MENU_ITEMS, reduceKey, renderMenu, runOptionsMenu };

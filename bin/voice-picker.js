'use strict';

// Interactive voice picker for the finish-task announcement — pure Node, zero deps.
// Mirrors color-picker.js but the "preview" here is AUDIO: moving the selection
// plays the chosen voice speaking the real announcement so the user can hear it.
//
// Voices are enumerated live from the device via bin/tts.js (real macOS/Windows/
// Linux voices), so the list never shows voices that don't exist on the machine.
// Pure pieces (buildMessage, reduceKey, renderPicker, windowFor, getVoices) are
// unit-tested; runVoicePicker/speak isolate TTY + audio side effects.

const { spawn } = require('child_process');
const { visualRowCount } = require('./color-picker');
const { getProvider } = require('./tts');

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// The off entry mirrors color's `none` — first row, disables the announcement.
const OFF = { name: 'off', label: 'Off (no voice)', id: '', lang: '' };

// Curated "personality" presets that rebrand novelty voices the OS already ships
// (legal, zero-download). Each maps to platform candidates: macOS novelty voice
// names, or espeak built-in variants on Linux. Windows SAPI has no novelty voices
// so presets simply don't resolve there. Resolved against the device's real list.
const PERSONALITY_PRESETS = [
    { key: 'robot', label: '🤖 Robot', mac: ['Zarvox'], linux: ['en'] },
    { key: 'alien', label: '🛸 Alien', mac: ['Trinoids'], linux: ['en+m7'] },
    { key: 'dramatic', label: '🎭 Dramatic', mac: ['Bad News'], linux: ['en+m4'] },
    { key: 'cheerful', label: '🎉 Good News', mac: ['Good News'], linux: ['en+m2'] },
    { key: 'opera', label: '🎻 Opera', mac: ['Cellos', 'Bells', 'Organ'], linux: [] },
    { key: 'bubbles', label: '🫧 Bubbles', mac: ['Bubbles'], linux: [] },
    { key: 'ghost', label: '👻 Whisper', mac: ['Whisper'], linux: ['en+whisper'] },
    { key: 'wobble', label: '🤪 Wobble', mac: ['Wobble'], linux: ['en+croak'] },
    { key: 'retro', label: '📟 Retro Mac', mac: ['Fred'], linux: [] },
];

// Resolve presets to real, available voices on this device. Returns picker
// entries { name, label, id, lang }. A preset is dropped if none of its
// candidates exist. Pure w.r.t. rawVoices; reads provider.platform/engine.
function resolvePresets(provider, rawVoices) {
    const platform = provider.platform || process.platform;
    if (platform === 'win32') return []; // no novelty voices in SAPI
    const out = [];
    if (platform === 'darwin') {
        const byId = new Map(rawVoices.map((v) => [v.id, v]));
        for (const p of PERSONALITY_PRESETS) {
            const hit = p.mac.find((id) => byId.has(id));
            if (hit) out.push({ name: `preset:${p.key}`, label: p.label, id: hit, lang: byId.get(hit).lang });
        }
        return out;
    }
    // linux — espeak variants are built-in, so available whenever espeak is
    if (provider.engine === 'espeak' || provider.engine === 'espeak-ng') {
        for (const p of PERSONALITY_PRESETS) {
            const id = p.linux[0];
            if (id) out.push({ name: `preset:${p.key}`, label: p.label, id, lang: 'en' });
        }
    }
    return out;
}

// Localized announcement templates keyed by 2-letter language prefix.
// Keep in sync with the message map in scripts/voice-notify.sh.
const MESSAGES = {
    en: 'Done: {topic}',
    es: 'Tarea terminada: {topic}',
    pt: 'Tarefa concluída: {topic}',
    fr: 'Tâche terminée : {topic}',
    de: 'Aufgabe erledigt: {topic}',
    it: 'Attività completata: {topic}',
    nl: 'Taak voltooid: {topic}',
    ja: 'タスク完了: {topic}',
    ko: '작업 완료: {topic}',
    ru: 'Задача выполнена: {topic}',
    zh: '任务完成：{topic}',
};

// Build the spoken announcement in the voice's language. Pure.
function buildMessage(lang, topic) {
    const code = String(lang || '').toLowerCase();
    let key = 'en';
    if (code.startsWith('zh') || code.startsWith('cmn') || code.startsWith('yue')) {
        key = 'zh';
    } else if (MESSAGES[code.slice(0, 2)]) {
        key = code.slice(0, 2);
    }
    return MESSAGES[key].replace('{topic}', topic);
}

// Devices ship dozens of voices across 40+ languages; most users only want a
// few. Show these languages up front and tuck the rest behind a toggle.
const PRIMARY_LANGS = ['en', 'es', 'pt'];

function isPrimaryLang(lang) {
    return PRIMARY_LANGS.includes(String(lang || '').slice(0, 2).toLowerCase());
}

// macOS novelty/legacy voice base names. The good ones are already surfaced as
// personality presets; the rest are noise for everyday use, so they go behind
// the toggle. Matched by base name so multilingual variants like
// "Eddy (English (UK))" are caught too. No-ops on Windows/Linux (different names).
const NOVELTY_VOICES = new Set([
    'Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Deranged',
    'Fred', 'Good News', 'Hysterical', 'Jester', 'Junior', 'Kathy', 'Organ',
    'Pipe Organ', 'Princess', 'Ralph', 'Superstar', 'Trinoids', 'Whisper', 'Wobble',
    'Zarvox', 'Bruce', 'Agnes', 'Vicki', 'Victoria',
    'Eddy', 'Flo', 'Grandma', 'Grandpa', 'Reed', 'Rocko', 'Sandy', 'Shelley',
]);

function isNoveltyVoice(id) {
    const base = String(id || '').split(' (')[0].trim();
    return NOVELTY_VOICES.has(base) || NOVELTY_VOICES.has(String(id));
}

// Assemble the picker list: Off + personality presets + the device's real voices
// in the primary languages (English/Spanish/Portuguese), then a "🌐 More
// languages" toggle that reveals every other language on demand. If the engine
// enumerates nothing (e.g. spd-say) or has no primary-language voices, the full
// list is shown without a toggle. Impure (calls the provider); injectable.
function getVoices(provider = getProvider(), opts = {}) {
    const raw = provider.listVoices();
    let voices = raw.map((v) => ({
        name: v.id || v.label,
        label: v.label,
        id: v.id,
        lang: v.lang,
    }));
    voices.sort((a, b) => (a.lang || '').localeCompare(b.lang || '') || (a.label || '').localeCompare(b.label || ''));
    if (voices.length === 0 && provider.isAvailable()) {
        voices = [{ name: 'default', label: 'System default voice', id: '', lang: '' }];
    }
    const presets = resolvePresets(provider, raw);
    const presetIds = new Set(presets.map((p) => p.id));
    // Drop voices already surfaced as a personality preset (no duplicates).
    voices = voices.filter((v) => !presetIds.has(v.id));
    const head = [OFF, ...presets];
    // Up front: real voices in the primary languages. Hidden: everything else
    // (other languages + macOS novelty/legacy voices).
    const upFront = (v) => isPrimaryLang(v.lang) && !isNoveltyVoice(v.id);
    const primary = voices.filter(upFront);
    const others = voices.filter((v) => !upFront(v));
    if (others.length === 0 || primary.length === 0) {
        return [...head, ...voices];
    }
    if (opts.expanded) {
        const less = { name: 'less', label: '🌐 Hide extra voices', id: '', lang: '', toggle: true };
        return [...head, ...primary, less, ...others];
    }
    const more = { name: 'more', label: `🌐 More voices (${others.length})`, id: '', lang: '', toggle: true };
    return [...head, ...primary, more];
}

// Is any TTS engine available on this device? Gates whether to open the picker.
function isVoiceAvailable(provider = getProvider()) {
    return provider.isAvailable();
}

// Reduce a keypress into a new index + an action. Pure.
// action ∈ 'move' | 'select' | 'cancel' | 'none'
function reduceKey(state, key) {
    const count = (state.voices || [OFF]).length;
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

// Compute the visible window [start, end) of a long list, keeping `index` in
// view and clamped to the list bounds. Pure.
function windowFor(index, total, maxRows) {
    if (total <= maxRows) return { start: 0, end: total };
    let start = index - Math.floor(maxRows / 2);
    if (start < 0) start = 0;
    if (start > total - maxRows) start = total - maxRows;
    return { start, end: start + maxRows };
}

// Render the full picker screen for a given state. Pure → returns a string.
// Only a viewport of `maxRows` voices is drawn so long lists (macOS 40+, espeak
// 100+) stay navigable and the cursor-up repaint never exceeds the terminal.
function renderPicker(state) {
    const voices = state.voices || [OFF];
    const { index } = state;
    const maxRows = state.maxRows || 10;
    const total = voices.length;
    const { start, end } = windowFor(index, total, maxRows);
    const lines = [];
    lines.push(`${BOLD}Choose the notification voice${RESET}  ${DIM}(↑↓ move · Enter/Space select · Esc cancel)${RESET}`);
    lines.push('');
    if (start > 0) lines.push(`   ${DIM}↑ ${start} more${RESET}`);
    for (let i = start; i < end; i++) {
        const { label, lang, toggle } = voices[i];
        const pointer = i === index ? '❱' : ' ';
        if (toggle) {
            lines.push(` ${pointer} ${DIM}${label}${RESET}`);
            continue;
        }
        const tag = lang ? `  ${DIM}(${lang})${RESET}` : '';
        lines.push(` ${pointer} ${BOLD}◆ ${label}${RESET}${tag}`);
    }
    if (end < total) lines.push(`   ${DIM}↓ ${total - end} more${RESET}`);
    lines.push('');
    lines.push(` ${DIM}Preview:${RESET}  ${DIM}plays the selected voice out loud — ↑↓ to hear each  ·  ${index + 1}/${total}${RESET}`);
    return lines.join('\n');
}

// Speak the announcement for an entry. Side-effecting; returns the spawned child
// (or null). `off` speaks nothing. provider/spawn injectable for testing.
function speak(entry, opts = {}) {
    if (!entry || entry.toggle || entry.name === 'off') return null;
    const provider = opts.provider || getProvider();
    const message = buildMessage(entry.lang, opts.sampleTopic || 'Deploy auth');
    const spawnFn = opts.spawn || spawn;
    try {
        const { cmd, args } = provider.speakCommand(entry.id, message, opts.volume);
        const child = spawnFn(cmd, args, { stdio: 'ignore', detached: true });
        if (child && child.unref) child.unref();
        return child;
    } catch {
        return null;
    }
}

// Side-effecting runner. Resolves the chosen entry { name, label, id, lang }, or
// null if cancelled / no TTY. input/output/speak/voices are injectable for tests.
function runVoicePicker(opts = {}) {
    const input = opts.input || process.stdin;
    const output = opts.output || process.stdout;

    if (!input.isTTY) {
        return Promise.resolve(null);
    }

    const speakFn = opts.speak || speak;
    const provider = opts.provider || getProvider();
    const injected = !!opts.voices;
    let expanded = false;
    const build = () => (injected ? opts.voices : getVoices(provider, { expanded }));
    let voices = build();

    const maxRows = opts.maxRows || Math.max(4, (output.rows || 24) - 7);

    let index = voices.findIndex((v) => !v.toggle && v.id === opts.initial);
    // If the saved voice lives in the hidden "other languages" section, open
    // expanded so it shows up pre-selected.
    if (index < 0 && !injected) {
        expanded = true;
        voices = build();
        index = voices.findIndex((v) => !v.toggle && v.id === opts.initial);
    }
    if (index < 0) index = 0;

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
            const screen = renderPicker({ index, voices, maxRows });
            output.write(screen + '\n');
            lastLineCount = visualRowCount(screen, output.columns);
        };

        const preview = () => {
            killAudio();
            lastChild = speakFn(voices[index]);
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
            const next = reduceKey({ index, voices }, key);
            index = next.index;
            if (next.action === 'select') {
                const cur = voices[index];
                if (cur && cur.toggle && !injected) {
                    expanded = !expanded;
                    voices = build();
                    const ti = voices.findIndex((v) => v.toggle);
                    index = ti >= 0 ? ti : Math.min(index, voices.length - 1);
                    killAudio();
                    draw();
                    return;
                }
                cleanup();
                const { name, label, id, lang } = voices[index];
                resolve({ name, label, id, lang });
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

module.exports = {
    MESSAGES,
    OFF,
    PERSONALITY_PRESETS,
    resolvePresets,
    buildMessage,
    getVoices,
    isVoiceAvailable,
    reduceKey,
    windowFor,
    renderPicker,
    speak,
    runVoicePicker,
};

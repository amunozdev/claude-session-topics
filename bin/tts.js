'use strict';

// Cross-platform text-to-speech abstraction — pure Node, zero deps.
// One provider per OS, each able to: report availability, enumerate the voices
// actually installed on the device, and build the spawn command to speak a line.
// Enumeration/availability touch the system; parsers and buildSpeakCommand are
// pure so they can be unit-tested without a TTS engine present.

const { execFileSync } = require('child_process');

// Does an executable exist on PATH? Used to gate availability and pick engines.
function commandExists(bin, platform = process.platform) {
    try {
        const finder = platform === 'win32' ? 'where' : 'which';
        execFileSync(finder, [bin], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

// Double single quotes for safe embedding inside a PowerShell '...' literal.
function psEscape(s) {
    return String(s).replace(/'/g, "''");
}

// ─── Pure parsers (one per engine output format) ─────────────────────────────

// macOS `say -v '?'`:  "Alex                en_US    # Most people recognize…"
function parseSayVoices(out) {
    const voices = [];
    for (const line of String(out).split('\n')) {
        const m = line.match(/^(.+?)\s{2,}([A-Za-z]{2}(?:[_-][A-Za-z0-9]{2,})?)\b/);
        if (m) {
            const name = m[1].trim();
            voices.push({ id: name, label: name, lang: m[2].replace('-', '_') });
        }
    }
    return voices;
}

// Windows SAPI list script emits "Name|||Culture" per line (see WIN_LIST_SCRIPT).
function parseWinVoices(out) {
    const voices = [];
    for (const line of String(out).split('\n')) {
        const t = line.trim();
        if (!t || t.indexOf('|||') < 0) continue;
        const [name, culture] = t.split('|||');
        voices.push({ id: name.trim(), label: name.trim(), lang: (culture || '').trim().replace('-', '_') });
    }
    return voices;
}

// espeak / espeak-ng `--voices`:
//  "Pty Language       Age/Gender VoiceName          File"
//  " 5  af              --/M      Afrikaans          gmw/af"
function parseEspeakVoices(out) {
    const voices = [];
    const seen = new Set();
    for (const line of String(out).split('\n')) {
        if (/^\s*Pty\b/.test(line) || !line.trim()) continue;
        const m = line.match(/^\s*\S+\s+(\S+)\s+\S+\s+(.+?)\s+\S+\s*$/);
        if (!m) continue;
        const lang = m[1];
        const label = m[2].trim();
        if (seen.has(lang)) continue; // collapse duplicate language rows
        seen.add(lang);
        voices.push({ id: lang, label, lang });
    }
    return voices;
}

// PowerShell snippet that prints installed SAPI voices as "Name|||Culture".
const WIN_LIST_SCRIPT =
    'Add-Type -AssemblyName System.Speech; ' +
    "(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | " +
    "ForEach-Object { $i=$_.VoiceInfo; Write-Output ($i.Name + '|||' + $i.Culture.Name) }";

// ─── Pure command builder ────────────────────────────────────────────────────

// Build the { cmd, args } to speak `message` with an optional voice id.
function buildSpeakCommand({ platform, engine, voiceId, message }) {
    if (platform === 'darwin') {
        return { cmd: 'say', args: voiceId ? ['-v', voiceId, message] : [message] };
    }
    if (platform === 'win32') {
        const sel = voiceId ? `$s.SelectVoice('${psEscape(voiceId)}'); ` : '';
        const script =
            'Add-Type -AssemblyName System.Speech; ' +
            '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
            sel +
            `$s.Speak('${psEscape(message)}')`;
        return { cmd: engine || 'powershell.exe', args: ['-NoProfile', '-Command', script] };
    }
    // linux
    if (engine === 'spd-say') {
        return { cmd: 'spd-say', args: voiceId ? ['-l', voiceId, message] : [message] };
    }
    return { cmd: engine || 'espeak', args: voiceId ? ['-v', voiceId, message] : [message] };
}

// ─── Providers (impure: enumeration/availability hit the system) ─────────────

function makeMacProvider() {
    return {
        platform: 'darwin',
        engine: 'say',
        isAvailable: () => commandExists('say', 'darwin'),
        listVoices() {
            try {
                return parseSayVoices(execFileSync('say', ['-v', '?'], { encoding: 'utf8' }));
            } catch {
                return [];
            }
        },
        speakCommand: (voiceId, message) => buildSpeakCommand({ platform: 'darwin', voiceId, message }),
    };
}

function makeWinProvider() {
    const bin = ['pwsh', 'powershell.exe', 'powershell'].find((b) => commandExists(b, 'win32')) || null;
    return {
        platform: 'win32',
        engine: bin,
        isAvailable: () => !!bin,
        listVoices() {
            if (!bin) return [];
            try {
                return parseWinVoices(execFileSync(bin, ['-NoProfile', '-Command', WIN_LIST_SCRIPT], { encoding: 'utf8' }));
            } catch {
                return [];
            }
        },
        speakCommand: (voiceId, message) => buildSpeakCommand({ platform: 'win32', engine: bin, voiceId, message }),
    };
}

function makeLinuxProvider() {
    const engine = ['espeak-ng', 'espeak', 'spd-say'].find((b) => commandExists(b, 'linux')) || null;
    return {
        platform: 'linux',
        engine,
        isAvailable: () => !!engine,
        listVoices() {
            if (!engine || engine === 'spd-say') return []; // spd-say → system default only
            try {
                return parseEspeakVoices(execFileSync(engine, ['--voices'], { encoding: 'utf8' }));
            } catch {
                return [];
            }
        },
        speakCommand: (voiceId, message) => buildSpeakCommand({ platform: 'linux', engine, voiceId, message }),
    };
}

// Resolve the provider for a platform (defaults to the current OS).
function getProvider(platform = process.platform) {
    if (platform === 'darwin') return makeMacProvider();
    if (platform === 'win32') return makeWinProvider();
    return makeLinuxProvider();
}

module.exports = {
    commandExists,
    psEscape,
    parseSayVoices,
    parseWinVoices,
    parseEspeakVoices,
    buildSpeakCommand,
    WIN_LIST_SCRIPT,
    getProvider,
};

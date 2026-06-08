import { describe, it, expect } from 'vitest';
import {
  parseSayVoices,
  parseWinVoices,
  parseEspeakVoices,
  buildSpeakCommand,
  psEscape,
  normalizeVolume,
} from '../../bin/tts.js';

describe('tts parsers', () => {
  describe('parseSayVoices (macOS)', () => {
    const out = [
      'Albert              en_US    # Hello! My name is Albert.',
      'Alice               it_IT    # Salve, mi chiamo Alice.',
      'Bad News            en_US    # The light you see ...',
      'Mónica              es_ES    # Hola, me llamo Mónica.',
      'Ava (Premium)       en_US    # Hi, my name is Ava.',
    ].join('\n');

    it('extracts name and locale, preserving spaces and parentheses in names', () => {
      const v = parseSayVoices(out);
      expect(v).toContainEqual({ id: 'Albert', label: 'Albert', lang: 'en_US' });
      expect(v).toContainEqual({ id: 'Bad News', label: 'Bad News', lang: 'en_US' });
      expect(v).toContainEqual({ id: 'Mónica', label: 'Mónica', lang: 'es_ES' });
      expect(v).toContainEqual({ id: 'Ava (Premium)', label: 'Ava (Premium)', lang: 'en_US' });
    });
  });

  describe('parseWinVoices (SAPI)', () => {
    it('splits Name|||Culture and normalizes the locale separator', () => {
      const out = 'Microsoft David Desktop|||en-US\nMicrosoft Helena Desktop|||es-ES\n';
      const v = parseWinVoices(out);
      expect(v).toEqual([
        { id: 'Microsoft David Desktop', label: 'Microsoft David Desktop', lang: 'en_US' },
        { id: 'Microsoft Helena Desktop', label: 'Microsoft Helena Desktop', lang: 'es_ES' },
      ]);
    });

    it('ignores lines without the delimiter', () => {
      expect(parseWinVoices('some banner line\nName|||en-US')).toHaveLength(1);
    });
  });

  describe('parseEspeakVoices (Linux)', () => {
    const out = [
      'Pty Language       Age/Gender VoiceName          File          Other Languages',
      ' 5  af              --/M      Afrikaans          gmw/af',
      ' 5  en-us           --/M      English (America)  en-us',
      ' 5  es              --/M      Spanish            roa/es',
      ' 5  es              --/M      Spanish (dup)      roa/es',
    ].join('\n');

    it('extracts language code and name, skips header, collapses duplicate languages', () => {
      const v = parseEspeakVoices(out);
      expect(v).toContainEqual({ id: 'af', label: 'Afrikaans', lang: 'af' });
      expect(v).toContainEqual({ id: 'en-us', label: 'English (America)', lang: 'en-us' });
      expect(v.filter((x) => x.lang === 'es')).toHaveLength(1);
      expect(v.find((x) => x.lang === 'Pty')).toBeUndefined();
    });
  });
});

describe('buildSpeakCommand', () => {
  it('macOS uses say -v when a voice id is given', () => {
    expect(buildSpeakCommand({ platform: 'darwin', voiceId: 'Mónica', message: 'Hola' }))
      .toEqual({ cmd: 'say', args: ['-v', 'Mónica', 'Hola'] });
  });

  it('macOS omits -v for the default voice', () => {
    expect(buildSpeakCommand({ platform: 'darwin', voiceId: '', message: 'Hi' }))
      .toEqual({ cmd: 'say', args: ['Hi'] });
  });

  it('Windows selects the voice and escapes single quotes', () => {
    const { cmd, args } = buildSpeakCommand({
      platform: 'win32',
      engine: 'powershell.exe',
      voiceId: "O'Brien",
      message: "It's done",
    });
    expect(cmd).toBe('powershell.exe');
    expect(args[0]).toBe('-NoProfile');
    expect(args[2]).toContain("SelectVoice('O''Brien')");
    expect(args[2]).toContain("Speak('It''s done')");
  });

  it('Linux espeak uses -v with the voice id', () => {
    expect(buildSpeakCommand({ platform: 'linux', engine: 'espeak-ng', voiceId: 'es', message: 'Hola' }))
      .toEqual({ cmd: 'espeak-ng', args: ['-v', 'es', 'Hola'] });
  });

  it('Linux spd-say falls back to a language flag', () => {
    expect(buildSpeakCommand({ platform: 'linux', engine: 'spd-say', voiceId: 'es', message: 'Hola' }))
      .toEqual({ cmd: 'spd-say', args: ['-l', 'es', 'Hola'] });
  });

  describe('volume', () => {
    it('macOS prepends the [[volm]] embedded command below full', () => {
      expect(buildSpeakCommand({ platform: 'darwin', voiceId: 'Mónica', message: 'Hola', volume: 70 }))
        .toEqual({ cmd: 'say', args: ['-v', 'Mónica', '[[volm 0.70]] Hola'] });
    });

    it('Windows sets $s.Volume before speaking', () => {
      const { args } = buildSpeakCommand({ platform: 'win32', engine: 'powershell.exe', voiceId: '', message: 'Hi', volume: 70 });
      expect(args[2]).toContain('$s.Volume = 70;');
    });

    it('Linux espeak passes -a amplitude (0–200)', () => {
      expect(buildSpeakCommand({ platform: 'linux', engine: 'espeak-ng', voiceId: 'es', message: 'Hola', volume: 70 }))
        .toEqual({ cmd: 'espeak-ng', args: ['-a', '140', '-v', 'es', 'Hola'] });
    });

    it('Linux spd-say maps to -i (−100..100)', () => {
      expect(buildSpeakCommand({ platform: 'linux', engine: 'spd-say', voiceId: 'es', message: 'Hola', volume: 70 }))
        .toEqual({ cmd: 'spd-say', args: ['-i', '40', '-l', 'es', 'Hola'] });
    });

    it('omits volume handling when unset or 100 (no behavior change)', () => {
      expect(buildSpeakCommand({ platform: 'darwin', voiceId: 'Alex', message: 'Hi' }))
        .toEqual({ cmd: 'say', args: ['-v', 'Alex', 'Hi'] });
      expect(buildSpeakCommand({ platform: 'linux', engine: 'espeak', voiceId: 'en', message: 'Hi', volume: 100 }))
        .toEqual({ cmd: 'espeak', args: ['-v', 'en', 'Hi'] });
    });
  });
});

describe('normalizeVolume', () => {
  it('returns null for unset or full (no change)', () => {
    expect(normalizeVolume(null)).toBeNull();
    expect(normalizeVolume(undefined)).toBeNull();
    expect(normalizeVolume(100)).toBeNull();
  });

  it('clamps out-of-range values', () => {
    expect(normalizeVolume(-5)).toBe(0);
    expect(normalizeVolume(250)).toBeNull(); // clamps to 100 → no change
    expect(normalizeVolume(50)).toBe(50);
  });
});

describe('psEscape', () => {
  it('doubles single quotes', () => {
    expect(psEscape("a'b'c")).toBe("a''b''c");
  });
});

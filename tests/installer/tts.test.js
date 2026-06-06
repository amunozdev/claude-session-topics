import { describe, it, expect } from 'vitest';
import {
  parseSayVoices,
  parseWinVoices,
  parseEspeakVoices,
  buildSpeakCommand,
  psEscape,
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
});

describe('psEscape', () => {
  it('doubles single quotes', () => {
    expect(psEscape("a'b'c")).toBe("a''b''c");
  });
});

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { runVolumePicker } from '../../bin/volume-picker.js';
import { runOptionsMenu } from '../../bin/options-menu.js';

// Minimal fake stdin: an EventEmitter that looks like a raw-mode TTY. Keypresses
// are delivered with emitKey() to drive the runner the way a real terminal would.
function makeInput() {
  const input = new EventEmitter();
  input.isTTY = true;
  input.setRawMode = vi.fn();
  input.resume = vi.fn();
  input.pause = vi.fn();
  input.emitKey = (k) => input.emit('data', Buffer.from(k));
  return input;
}

function makeOutput() {
  const writes = [];
  return { write: (s) => writes.push(s), columns: 80, rows: 24, writes };
}

const ESC = { UP: '\x1b[A', DOWN: '\x1b[B', ENTER: '\r', ESCAPE: '\x1b' };

describe('runVolumePicker (TTY integration)', () => {
  it('resolves null without a TTY (no picker shown)', async () => {
    const input = makeInput();
    input.isTTY = false;
    await expect(runVolumePicker({ input, output: makeOutput() })).resolves.toBeNull();
  });

  it('previews each level with the chosen voice, then resolves the selected volume', async () => {
    const input = makeInput();
    const output = makeOutput();
    const speak = vi.fn(() => ({ kill: vi.fn() }));
    const voiceEntry = { id: 'Mónica', lang: 'es' };

    const p = runVolumePicker({ input, output, speak, voiceEntry, initial: 50 });

    input.emitKey(ESC.UP);   // 50 → 60, previews
    input.emitKey(ESC.UP);   // 60 → 70, previews
    input.emitKey(ESC.DOWN); // 70 → 60, previews
    input.emitKey(ESC.ENTER); // select 60

    await expect(p).resolves.toBe(60);
    // Each move plays the voice at the new level.
    expect(speak).toHaveBeenCalledWith(voiceEntry, { volume: 60 });
    expect(speak).toHaveBeenCalledWith(voiceEntry, { volume: 70 });
    expect(speak.mock.calls.at(-1)).toEqual([voiceEntry, { volume: 60 }]);
    // Raw mode is restored on exit.
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it('clamps at the ceiling and floor', async () => {
    const input = makeInput();
    const p = runVolumePicker({ input, output: makeOutput(), speak: vi.fn(() => ({ kill() {} })), initial: 90 });
    input.emitKey(ESC.UP); // 90 → 100
    input.emitKey(ESC.UP); // stays 100
    input.emitKey(ESC.ENTER);
    await expect(p).resolves.toBe(100);
  });

  it('resolves null when cancelled with Esc', async () => {
    const input = makeInput();
    const p = runVolumePicker({ input, output: makeOutput(), speak: vi.fn(() => ({ kill() {} })), initial: 30 });
    input.emitKey(ESC.ESCAPE);
    await expect(p).resolves.toBeNull();
  });
});

describe('runOptionsMenu (TTY integration)', () => {
  it('resolves null without a TTY', async () => {
    const input = makeInput();
    input.isTTY = false;
    await expect(runOptionsMenu({ input, output: makeOutput() })).resolves.toBeNull();
  });

  it('selecting the first row returns "color"', async () => {
    const input = makeInput();
    const p = runOptionsMenu({ input, output: makeOutput(), settings: { color: 'cyan', voiceLabel: 'Off', volume: 100 } });
    input.emitKey(ESC.ENTER);
    await expect(p).resolves.toBe('color');
  });

  it('navigating down twice and selecting returns "volume"', async () => {
    const input = makeInput();
    const p = runOptionsMenu({ input, output: makeOutput() });
    input.emitKey(ESC.DOWN); // Color → Voice
    input.emitKey(ESC.DOWN); // Voice → Volume
    input.emitKey(ESC.ENTER);
    await expect(p).resolves.toBe('volume');
  });

  it('selecting Quit (last row) resolves null', async () => {
    const input = makeInput();
    const p = runOptionsMenu({ input, output: makeOutput() });
    input.emitKey(ESC.UP); // wraps from Color up to Quit
    input.emitKey(ESC.ENTER);
    await expect(p).resolves.toBeNull();
  });

  it('Esc quits and resolves null', async () => {
    const input = makeInput();
    const p = runOptionsMenu({ input, output: makeOutput() });
    input.emitKey(ESC.ESCAPE);
    await expect(p).resolves.toBeNull();
  });

  it('renders the current settings in the screen', async () => {
    const input = makeInput();
    const output = makeOutput();
    const p = runOptionsMenu({ input, output, settings: { color: 'orange', voiceLabel: 'Paulina', volume: 60 } });
    input.emitKey(ESC.ESCAPE);
    await p;
    const screen = output.writes.join('');
    expect(screen).toContain('orange');
    expect(screen).toContain('Paulina');
    expect(screen).toContain('60%');
  });
});

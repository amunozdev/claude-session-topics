import { describe, it, expect } from 'vitest';
import {
  clampVolume,
  reduceKey,
  volumeToBar,
  renderPicker,
} from '../../bin/volume-picker.js';

describe('clampVolume', () => {
  it('snaps to multiples of 10 within 0–100', () => {
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(73)).toBe(70);
    expect(clampVolume(75)).toBe(80);
    expect(clampVolume(100)).toBe(100);
  });

  it('clamps out-of-range and defaults garbage to 100', () => {
    expect(clampVolume(-20)).toBe(0);
    expect(clampVolume(250)).toBe(100);
    expect(clampVolume(NaN)).toBe(100);
  });
});

describe('reduceKey', () => {
  it('up/right raises by 10, clamped at 100', () => {
    expect(reduceKey({ volume: 50 }, '\x1b[A')).toEqual({ volume: 60, action: 'move' });
    expect(reduceKey({ volume: 50 }, '\x1b[C')).toEqual({ volume: 60, action: 'move' });
    expect(reduceKey({ volume: 100 }, '\x1b[A')).toEqual({ volume: 100, action: 'move' });
  });

  it('down/left lowers by 10, clamped at 0', () => {
    expect(reduceKey({ volume: 50 }, '\x1b[B')).toEqual({ volume: 40, action: 'move' });
    expect(reduceKey({ volume: 0 }, '\x1b[B')).toEqual({ volume: 0, action: 'move' });
  });

  it('enter/space selects, escape/ctrl-c cancels', () => {
    expect(reduceKey({ volume: 30 }, '\r').action).toBe('select');
    expect(reduceKey({ volume: 30 }, ' ').action).toBe('select');
    expect(reduceKey({ volume: 30 }, '\x1b').action).toBe('cancel');
    expect(reduceKey({ volume: 30 }, '\x03').action).toBe('cancel');
  });

  it('ignores unknown keys', () => {
    expect(reduceKey({ volume: 30 }, 'x')).toEqual({ volume: 30, action: 'none' });
  });
});

describe('volumeToBar', () => {
  it('renders a 10-block bar proportional to the level', () => {
    expect(volumeToBar(0)).toBe('[----------]');
    expect(volumeToBar(70)).toBe('[#######---]');
    expect(volumeToBar(100)).toBe('[##########]');
  });
});

describe('renderPicker', () => {
  it('shows the percentage and the bar', () => {
    const screen = renderPicker({ volume: 70 });
    expect(screen).toContain('Volume: 70%');
    expect(screen).toContain('[#######---]');
  });
});

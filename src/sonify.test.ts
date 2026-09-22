import { describe, expect, it } from 'vitest';
import { hailstone } from './collatz';
import { isOddPrimePower } from './parse';
import {
  MIDI_LOW,
  cadenceIndex,
  isPowerOfTwo,
  midiForValue,
  schedulePlan,
  scoreTrajectory,
} from './sonify';

describe('trajectory score', () => {
  it('maps log2 into a descending C-major pentatonic cadence for 4, 2, 1', () => {
    const four = midiForValue(4n);
    const two = midiForValue(2n);
    const one = midiForValue(1n);
    expect(one).toBe(MIDI_LOW);
    expect(four).toBeGreaterThan(two);
    expect(two).toBeGreaterThan(one);
    for (const midi of [four, two, one]) {
      expect([0, 2, 4, 7, 9]).toContain(midi % 12);
      expect(midi).toBeGreaterThanOrEqual(MIDI_LOW);
      expect(midi).toBeLessThanOrEqual(84);
    }
  });

  it('gives the right hand to 27 and the left hand to the following composite', () => {
    const score = scoreTrajectory(hailstone(27n, 10_000));
    expect(score.truncated).toBe(false);
    expect(score.notes[0]).toMatchObject({ value: 27n, hand: 'right' });
    const next = score.notes[1];
    expect(next.value).toBe(82n);
    expect(next.hand).toBe('left');
    expect(isOddPrimePower(27n)).toBe(true);
    expect(isOddPrimePower(82n)).toBe(false);
    const cadence = score.notes.filter((note) => note.hand === 'both');
    expect(cadence.map((note) => note.value).slice(-3)).toEqual([4n, 2n, 1n]);
    expect(cadence.at(-3)?.midi).toBe(midiForValue(4n));
    expect(cadence.at(-2)?.midi).toBe(midiForValue(2n));
    expect(cadence.at(-1)?.midi).toBe(midiForValue(1n));
    for (let i = 1; i < cadence.length; i += 1) {
      expect(cadence[i].midi).toBeLessThan(cadence[i - 1].midi);
    }
  });

  it('leaves 9 on the left hand and still converges on the same 4, 2, 1 pitches', () => {
    const score = scoreTrajectory(hailstone(9n, 100));
    expect(score.notes[0]).toMatchObject({ value: 9n, hand: 'left' });
    expect(score.notes.find((note) => note.value === 7n)?.hand).toBe('right');
    expect(score.notes.find((note) => note.value === 8n)?.hand).toBe('both');
    expect(score.notes.find((note) => note.value === 16n)?.hand).toBe('both');
    const tail = score.notes.slice(-3).map((note) => note.midi);
    const classic = scoreTrajectory(hailstone(27n, 10_000)).notes.slice(-3).map((note) => note.midi);
    expect(tail).toEqual(classic);
    expect(cadenceIndex(hailstone(9n, 100).values)).toBeLessThan(score.notes.length);
  });

  it('offsets only the left hand, and puts both hands together on powers of 2', () => {
    const score = scoreTrajectory(hailstone(27n, 10_000));
    const plan = schedulePlan(score, 200, { right: true, left: true });
    const left = plan.find((note) => note.kind === 'left' && note.midi === score.notes[1].midi);
    expect(left?.time).toBeCloseTo(1 * 0.2 + 0.1);
    const right = plan.find((note) => note.kind === 'right' && note.time === 0);
    expect(right?.kind).toBe('right');
    const unison = plan.filter((note) => note.time === (score.notes.length - 1) * 0.2);
    expect(unison.map((note) => note.kind).sort()).toEqual(['left', 'right']);
    expect(new Set(unison.map((note) => note.midi)).size).toBe(1);
    const rightOnly = schedulePlan(score, 200, { right: true, left: false });
    expect(rightOnly.every((note) => note.kind === 'right')).toBe(true);
    expect(rightOnly.some((note) => note.time === (score.notes.length - 1) * 0.2)).toBe(true);
  });

  it('treats 1 as a power of two and 9 as not', () => {
    expect(isPowerOfTwo(1n)).toBe(true);
    expect(isPowerOfTwo(8n)).toBe(true);
    expect(isPowerOfTwo(9n)).toBe(false);
    const only = scoreTrajectory(hailstone(1n, 10));
    expect(only.notes).toEqual([{ step: 0, value: 1n, hand: 'both', midi: MIDI_LOW }]);
  });
});

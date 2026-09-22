import { describe, expect, it } from 'vitest';
import { hailstone } from './collatz';
import { stepsInAxisRange } from './chart';
import { isOddPrimePower } from './parse';
import {
  LEFT_HAND_ROLL,
  MIDI_LOW,
  cadenceIndex,
  isPowerOfTwo,
  leftHandRoll,
  midiForValue,
  parseInstrument,
  schedulePlan,
  scoreTrajectory,
  voiceFor,
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

  it('rolls the left hand after the beat and rests both hands together on powers of 2', () => {
    const score = scoreTrajectory(hailstone(27n, 10_000));
    const plan = schedulePlan(score, 200, { right: true, left: true });
    const step = 0.2;
    const roll = plan.filter((note) => note.kind === 'left' && note.time > step && note.time < step * 2);
    expect(roll.map((note) => note.time)).toEqual(LEFT_HAND_ROLL.map((fraction) => step + fraction * step));
    expect(roll.map((note) => note.midi)).toEqual(leftHandRoll(score.notes[1].midi));
    expect(roll[0].time).toBeGreaterThan(step);
    expect(roll[2].time).toBeLessThan(step * 2);
    expect(roll[2].midi).toBe(score.notes[1].midi);
    const right = plan.find((note) => note.kind === 'right' && note.time === 0);
    expect(right?.midi).toBe(score.notes[0].midi);
    expect(right?.settle).toBe(false);
    const unison = plan.filter((note) => note.time === (score.notes.length - 1) * step);
    expect(unison.map((note) => note.kind).sort()).toEqual(['left', 'right']);
    expect(unison.every((note) => note.settle && note.ring)).toBe(true);
    expect(new Set(unison.map((note) => note.midi)).size).toBe(1);
    const rightOnly = schedulePlan(score, 200, { right: true, left: false });
    expect(rightOnly.every((note) => note.kind === 'right')).toBe(true);
    expect(rightOnly.some((note) => note.time === (score.notes.length - 1) * step)).toBe(true);
    const other = score.notes.find((note) => note.hand === 'left' && note.midi !== score.notes[1].midi);
    expect(other).toBeDefined();
    expect(leftHandRoll(other!.midi)).not.toEqual(leftHandRoll(score.notes[1].midi));
  });

  it('treats 1 as a power of two and 9 as not', () => {
    expect(isPowerOfTwo(1n)).toBe(true);
    expect(isPowerOfTwo(8n)).toBe(true);
    expect(isPowerOfTwo(9n)).toBe(false);
    const only = scoreTrajectory(hailstone(1n, 10));
    expect(only.notes[0]).toMatchObject({ step: 0, value: 1n, hand: 'both', midi: MIDI_LOW });
    expect(only.notes[0].dynamics).toBeLessThan(0.3);
  });

  it('swells toward each local peak and eases before the next climb', () => {
    const score = scoreTrajectory(hailstone(27n, 10_000));
    const before = score.notes.slice(0, score.cadenceAt);
    const peak = before.find((note) => note.value === 9232n);
    expect(peak).toBeDefined();
    expect(peak!.dynamics).toBeGreaterThan(0.9);
    expect(peak!.dynamics).toBeGreaterThan(before[0].dynamics);
    const afterPeak = before[peak!.step + 1];
    expect(afterPeak.dynamics).toBeLessThan(peak!.dynamics);
    let eased = false;
    let swelledAgain = false;
    for (let i = peak!.step + 1; i < before.length; i += 1) {
      if (before[i].dynamics < peak!.dynamics - 0.2) eased = true;
      if (eased && before[i].dynamics > before[i - 1].dynamics + 0.05) swelledAgain = true;
    }
    expect(eased).toBe(true);
    expect(swelledAgain).toBe(true);
    const cadence = score.notes.slice(score.cadenceAt);
    expect(cadence.at(-1)!.dynamics).toBeLessThanOrEqual(cadence[0].dynamics);
    expect(cadence.at(-1)!.dynamics).toBeLessThan(peak!.dynamics);
    const plan = schedulePlan(score, 200, { right: true, left: true });
    const peakGain = plan.find((note) => note.time >= peak!.step * 0.2 && note.time < (peak!.step + 1) * 0.2);
    expect(peakGain?.gain).toBeCloseTo(peak!.dynamics);
  });

  it('scores only the steps inside an axis range and skips a cadence that falls outside it', () => {
    const longer = hailstone(27n, 10_000);
    const shorter = hailstone(47n, 10_000);
    const maxStep = longer.values.length - 1;
    expect(maxStep).toBe(111);
    expect(shorter.values.length - 1).toBe(104);

    const off = stepsInAxisRange(maxStep, maxStep, false, { start: 40, end: 90 });
    const aligned = stepsInAxisRange(104, maxStep, true, { start: 40, end: 90 });
    expect(off).toEqual({ from: 40, to: 90 });
    expect(aligned).toEqual({ from: 33, to: 83 });

    const middle = scoreTrajectory(longer, 2_000, off!);
    expect(middle.notes).toHaveLength(51);
    expect(middle.notes[0].value).toBe(longer.values[40]);
    expect(middle.notes.at(-1)!.value).toBe(longer.values[90]);
    expect(middle.notes.map((note) => note.step)).toEqual(middle.notes.map((_, index) => index));
    expect(middle.notes.some((note) => note.hand === 'both')).toBe(false);
    expect(middle.truncated).toBe(false);
    const plan = schedulePlan(middle, 100, { right: true, left: true });
    const times = plan.map((note) => note.time);
    expect(Math.min(...times)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...times)).toBeLessThan(0.1);
    expect(Math.max(...times)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...times)).toBeLessThan(5.1);

    const shifted = scoreTrajectory(shorter, 2_000, aligned!);
    expect(shifted.notes[0].value).toBe(shorter.values[33]);
    expect(shifted.notes.at(-1)!.value).toBe(shorter.values[83]);
    expect(shifted.notes.some((note) => note.hand === 'both')).toBe(false);

    expect(stepsInAxisRange(104, maxStep, true, { start: 0, end: 6 })).toBeNull();
    expect(scoreTrajectory(longer, 2_000, { from: 5, to: 4 }).notes).toHaveLength(0);

    const fullCadence = cadenceIndex(longer.values);
    const tail = scoreTrajectory(longer, 2_000, { from: fullCadence, to: longer.values.length - 1 });
    expect(tail.notes.length).toBeGreaterThan(0);
    expect(tail.notes.every((note) => note.hand === 'both')).toBe(true);
    expect(tail.notes.map((note) => note.value)).toEqual(longer.values.slice(fullCadence));

    const partial = scoreTrajectory(longer, 2_000, { from: longer.values.length - 2, to: longer.values.length - 1 });
    expect(partial.notes.map((note) => note.value)).toEqual([2n, 1n]);
    expect(partial.notes.every((note) => note.hand === 'both')).toBe(true);

    const before = scoreTrajectory(longer, 2_000, { from: 0, to: fullCadence - 1 });
    expect(before.notes.some((note) => note.hand === 'both')).toBe(false);
    expect(before.notes.at(-1)!.value).toBe(longer.values[fullCadence - 1]);
  });

  it('assigns each hand an instrument without moving the written notes', () => {
    const score = scoreTrajectory(hailstone(27n, 100));
    const mixed = schedulePlan(score, 140, { right: true, left: true, rightInstrument: 'organ', leftInstrument: 'bass' });
    expect(mixed.filter((note) => note.kind === 'right').every((note) => note.instrument === 'organ')).toBe(true);
    expect(mixed.filter((note) => note.kind === 'left').every((note) => note.instrument === 'bass')).toBe(true);
    const piano = schedulePlan(score, 140, { right: true, left: true });
    expect(piano.every((note) => note.instrument === 'piano')).toBe(true);
    expect(mixed.map((note) => note.time)).toEqual(piano.map((note) => note.time));
    expect(mixed.map((note) => note.midi)).toEqual(piano.map((note) => note.midi));

    const window = scoreTrajectory(hailstone(27n, 10_000), 2_000, { from: 40, to: 90 });
    const scoped = schedulePlan(window, 100, { right: true, left: true, rightInstrument: 'rhodes', leftInstrument: 'pluck' });
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.filter((note) => note.kind === 'right').every((note) => note.instrument === 'rhodes')).toBe(true);
    expect(scoped.filter((note) => note.kind === 'left').every((note) => note.instrument === 'pluck')).toBe(true);
    expect(Math.min(...scoped.map((note) => note.time))).toBeLessThan(0.1);
    expect(Math.max(...scoped.map((note) => note.time))).toBeLessThan(5.1);
  });

  it('keeps the original piano voice and distinguishes the other timbres', () => {
    const piano = voiceFor('piano', 'right', false, false);
    expect(piano.partials.map((partial) => partial.weight)).toEqual([1, 0.48, 0.22, 0.1, 0.04]);
    expect(piano.attack).toBe(0.004);
    expect(piano.decay).toBe(0.38);
    expect(piano.peak).toBe(0.2);
    expect(piano.hammer).toBe(0.05);
    expect(piano.transpose).toBe(0);
    expect(piano.filter).toBeNull();
    expect(voiceFor('piano', 'left', false, false).peak).toBe(0.04);
    expect(voiceFor('piano', 'right', true, true).hammer).toBe(0);
    expect(voiceFor('piano', 'right', true, true).decay).toBe(2.6);

    expect(voiceFor('strings', 'right', false, false).attack).toBeGreaterThan(piano.attack);
    expect(voiceFor('pluck', 'right', false, false).decay).toBeLessThan(piano.decay);
    expect(voiceFor('bass', 'left', false, false).transpose).toBe(-12);
    expect(voiceFor('organ', 'right', false, false).hammer).toBe(0);
    expect(voiceFor('organ', 'right', false, false).partials.length).toBeGreaterThan(3);
    expect(voiceFor('rhodes', 'right', false, false).partials.some((partial) => partial.ratio % 1 !== 0)).toBe(true);
    expect(voiceFor('lead', 'right', false, false).filter?.type).toBe('lowpass');
    expect(voiceFor('strings', 'right', true, false).hammer).toBe(0);
    expect(parseInstrument('bass')).toBe('bass');
    expect(parseInstrument('nope')).toBe('piano');
    expect(parseInstrument(null)).toBe('piano');
  });
});

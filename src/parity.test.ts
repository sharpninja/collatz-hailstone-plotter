import { describe, expect, it } from 'vitest';
import { hailstone } from './collatz';
import { groupParityForms, parityForm, primeParitySummary } from './parity';

describe('parityForm', () => {
  it('writes the hand-checked identity for 3', () => {
    const trajectory = hailstone(3n, 20);
    const form = parityForm(trajectory.values, trajectory);
    expect(form.expression).toBe('(3^2 · N + m) / 2^5 = 1');
    expect(form.parameters).toBe('o = 2 · e = 5 · m = 5');
    expect(form.solvedForSeed).toBe('N = (2^5 − m) / 3^2');
    expect(form.exact).toBe(true);
    expect(form.reachedOne).toBe(true);
    expect(form.terms).toHaveLength(trajectory.values.length);
    expect(form.terms?.[0]).toBe('0: N = 3');
    expect(form.terms?.at(-1)).toBe('7: (3^2 · N + 5) / 2^5 = 1');
  });

  it('writes an even-only path as N divided by a power of two', () => {
    const trajectory = hailstone(8n, 10);
    const form = parityForm(trajectory.values, trajectory);
    expect(trajectory.values).toEqual([8n, 4n, 2n, 1n]);
    expect(form.expression).toBe('N / 2^3 = 1');
    expect(form.parameters).toBe('o = 0 · e = 3 · m = 0');
    expect(form.solvedForSeed).toBe('N = 2^3');
    expect(form.exact).toBe(true);
  });

  it('treats a seed that is already 1 as N itself', () => {
    const trajectory = hailstone(1n, 10);
    const form = parityForm(trajectory.values, trajectory);
    expect(form.expression).toBe('N = 1');
    expect(form.parameters).toBe('o = 0 · e = 0 · m = 0');
    expect(form.solvedForSeed).toBeNull();
    expect(form.note).toMatch(/already 1/i);
  });

  it('matches every term of 27 and solves back to the seed', () => {
    const trajectory = hailstone(27n, 10_000);
    const form = parityForm(trajectory.values, trajectory);
    expect(trajectory.reachedOne).toBe(true);
    expect(form.exact).toBe(true);
    expect(form.reachedOne).toBe(true);
    expect(form.expression).toMatch(/^\(3\^\d+ · N \+ m\) \/ 2\^\d+ = 1$/);
    expect(form.solvedForSeed).toMatch(/^N = \(2\^\d+ − m\) \/ 3\^\d+$/);
    expect(form.note).toMatch(/does not prove the conjecture/i);
    expect(form.terms).toHaveLength(112);
    const numerator = 3n ** BigInt(form.oddSteps) * 27n + form.offset;
    const denominator = 1n << BigInt(form.divisions);
    expect(numerator / denominator).toBe(1n);
    expect((denominator - form.offset) / 3n ** BigInt(form.oddSteps)).toBe(27n);
  });

  it('groups identical parity signatures and keeps different ones apart', () => {
    const odds = [3n, 5n, 7n, 9n].map((seed) => hailstone(seed, 2));
    const grouped = groupParityForms(odds.map((trajectory) => parityForm(trajectory.values, trajectory)));
    expect(grouped).toHaveLength(1);
    expect(grouped[0].seeds).toEqual([3n, 5n, 7n, 9n]);
    expect(grouped[0].oddSteps).toBe(1);
    expect(grouped[0].divisions).toBe(1);
    expect(grouped[0].offset).toBe(1n);
    expect(grouped[0].expression).toBe('(3^1 · N + m) / 2^1');
    expect(grouped[0].parameters).toBe('o = 1 · e = 1 · m = 1');

    const evens = [4n, 6n, 10n].map((seed) => hailstone(seed, 1));
    const evenGroup = groupParityForms(evens.map((trajectory) => parityForm(trajectory.values, trajectory)));
    expect(evenGroup).toHaveLength(1);
    expect(evenGroup[0].expression).toBe('N / 2^1');
    expect(evenGroup[0].seeds).toEqual([4n, 6n, 10n]);

    const mixed = [3n, 4n].map((seed) => hailstone(seed, 1));
    const split = groupParityForms(mixed.map((trajectory) => parityForm(trajectory.values, trajectory)));
    expect(split.map((group) => group.seeds)).toEqual([[3n], [4n]]);
    expect(split[0].expression).toBe('(3^1 · N + m)');
    expect(split[1].expression).toBe('N / 2^1');

    const finished = [hailstone(27n, 10_000), hailstone(27n, 10_000), hailstone(8n, 10)];
    const patterns = groupParityForms(finished.map((trajectory) => parityForm(trajectory.values, trajectory)));
    expect(patterns).toHaveLength(2);
    expect(patterns[0].seeds).toEqual([27n, 27n]);
    expect(patterns[1].seeds).toEqual([8n]);
    expect(patterns[0].expression).not.toBe(patterns[1].expression);
    expect(patterns[0].solvedForSeed).toMatch(/^N = /);
    expect(patterns[1].expression).toBe('N / 2^3');
  });

  it('keeps a capped prefix exact without claiming a map onto 1', () => {
    const trajectory = hailstone(27n, 10);
    const form = parityForm(trajectory.values, trajectory);
    expect(trajectory.reachedOne).toBe(false);
    expect(form.exact).toBe(true);
    expect(form.reachedOne).toBe(false);
    expect(form.solvedForSeed).toBeNull();
    expect(form.value).toBe(trajectory.values.at(-1));
    expect(form.note).toMatch(/iteration cap/i);
    expect(form.note).toMatch(/not a completed map/i);
    const numerator = 3n ** BigInt(form.oddSteps) * 27n + form.offset;
    expect(numerator / (1n << BigInt(form.divisions))).toBe(form.value);
  });

  it('counts distinct parity forms among prime seeds without claiming a proof', () => {
    expect(primeParitySummary(7, 7)).toBe('These 7 prime seeds take 7 distinct parity forms.');
    expect(primeParitySummary(7, 1)).toBe('These 7 prime seeds take 1 distinct parity form.');
    expect(primeParitySummary(1, 1)).toBe('This prime seed takes 1 distinct parity form.');
    expect(primeParitySummary(2, 2)).toBe('These 2 prime seeds take 2 distinct parity forms.');
  });
});

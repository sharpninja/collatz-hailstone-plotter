import { describe, expect, it } from 'vitest';
import { hailstone } from './collatz';
import { parityForm } from './parity';

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
});

import { describe, expect, it } from 'vitest';
import { hailstone, peakValue } from './collatz';
import { parseMaxIterations, parseSeeds } from './parse';

describe('hailstone', () => {
  it('stops immediately at 1', () => {
    const trajectory = hailstone(1n, 10);
    expect(trajectory.values).toEqual([1n]);
    expect(trajectory.reachedOne).toBe(true);
  });

  it('follows the even and odd rules', () => {
    expect(hailstone(2n, 10).values).toEqual([2n, 1n]);
    expect(hailstone(3n, 20).values).toEqual([3n, 10n, 5n, 16n, 8n, 4n, 2n, 1n]);
    expect(hailstone(6n, 20).values).toEqual([6n, 3n, 10n, 5n, 16n, 8n, 4n, 2n, 1n]);
  });

  it('draws the classic 27 trajectory through its peak and down to 1', () => {
    const trajectory = hailstone(27n, 10_000);
    expect(trajectory.reachedOne).toBe(true);
    expect(trajectory.values.at(-1)).toBe(1n);
    expect(trajectory.values).toHaveLength(112);
    expect(peakValue(trajectory.values)).toBe(9232n);
    const peakAt = trajectory.values.indexOf(9232n);
    expect(peakAt).toBeGreaterThan(0);
    expect(peakAt).toBeLessThan(trajectory.values.length - 1);
    let rises = 0;
    let falls = 0;
    for (let i = 1; i < trajectory.values.length; i++) {
      if (trajectory.values[i] > trajectory.values[i - 1]) rises += 1;
      else falls += 1;
    }
    expect(rises).toBeGreaterThan(10);
    expect(falls).toBeGreaterThan(10);
  });

  it('honors the iteration cap', () => {
    const trajectory = hailstone(27n, 10);
    expect(trajectory.reachedOne).toBe(false);
    expect(trajectory.stoppedForSize).toBe(false);
    expect(trajectory.values).toHaveLength(11);
  });

  it('stops before a term overflows the chart', () => {
    const seed = 10n ** 308n - 1n;
    const huge = hailstone(seed, 5);
    expect(huge.stoppedForSize).toBe(true);
    expect(huge.reachedOne).toBe(false);
    expect(huge.values).toEqual([seed]);
  });
});

describe('parseSeeds', () => {
  it('accepts commas, spaces, and leading zeros', () => {
    expect(parseSeeds('27, 12 19').seeds).toEqual([27n, 12n, 19n]);
    expect(parseSeeds('0008').seeds).toEqual([8n]);
  });

  it('rejects non-positive tokens and counts duplicates', () => {
    const parsed = parseSeeds('0, -3, 1.5, 27, 27, foo');
    expect(parsed.seeds).toEqual([27n]);
    expect(parsed.rejected).toEqual(['0', '-3', '1.5', 'foo']);
    expect(parsed.duplicates).toBe(1);
  });

  it('keeps the first 12 distinct seeds', () => {
    const parsed = parseSeeds(Array.from({ length: 14 }, (_, i) => String(i + 1)).join(','));
    expect(parsed.seeds).toHaveLength(12);
    expect(parsed.omitted).toBe(2);
  });
});

describe('parseMaxIterations', () => {
  it('accepts a positive integer inside the cap', () => {
    expect(parseMaxIterations('10000')).toBe(10_000);
    expect(parseMaxIterations('0')).toBeNull();
    expect(parseMaxIterations('200001')).toBeNull();
    expect(parseMaxIterations('1.5')).toBeNull();
    expect(parseMaxIterations('')).toBeNull();
  });
});

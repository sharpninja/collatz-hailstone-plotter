import { describe, expect, it } from 'vitest';
import { hailstone } from './collatz';
import { fitSeries } from './fit';

describe('fitSeries', () => {
  it('recovers a line through the samples', () => {
    const fit = fitSeries([1n, 3n, 5n, 7n], { logSpace: false });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.summary.startsWith('Linear')).toBe(true);
    expect(fit.expression).toBe('value ≈ 1 + 2·iteration');
    expect(fit.substitution).toBeNull();
    expect(fit.r2).toBe(1);
    expect(fit.predict(0)).toBeCloseTo(1);
    expect(fit.predict(3)).toBeCloseTo(7);
  });

  it('keeps an exact line linear when a higher degree could interpolate noise', () => {
    const values = Array.from({ length: 15 }, (_, index) => BigInt(5 + 2 * index));
    const fit = fitSeries(values, { logSpace: false });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.summary.startsWith('Linear')).toBe(true);
    expect(fit.expression).toBe('value ≈ 5 + 2·iteration');
    expect(fit.predict(10)).toBeCloseTo(25);
  });

  it('writes a descending line with a minus sign', () => {
    const fit = fitSeries([9n, 7n, 5n, 3n, 1n], { logSpace: false });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.expression).toBe('value ≈ 9 − 2·iteration');
    expect(fit.predict(4)).toBeCloseTo(1);
  });

  it('recovers a quadratic and evaluates it in the original units', () => {
    const values = Array.from({ length: 13 }, (_, index) => BigInt((index + 1) ** 2));
    const fit = fitSeries(values, { logSpace: false });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.summary.startsWith('Quadratic')).toBe(true);
    expect(fit.substitution).toMatch(/^t = /);
    expect(fit.r2).toBeGreaterThan(0.999);
    expect(fit.predict(0)).toBeCloseTo(1, 4);
    expect(fit.predict(3)).toBeCloseTo(16, 4);
    expect(fit.predict(12)).toBeCloseTo(169, 3);
  });

  it('reports a constant when every sample has the same height', () => {
    const fit = fitSeries([4n, 4n, 4n, 4n], { logSpace: false });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.expression).toBe('value ≈ 4');
    expect(fit.summary.startsWith('Constant')).toBe(true);
    expect(fit.predict(2)).toBeCloseTo(4);
    expect(fit.note).toMatch(/same height/i);
  });

  it('refuses a single term', () => {
    const fit = fitSeries([1n], { logSpace: false });
    expect(fit.ok).toBe(false);
    if (fit.ok) return;
    expect(fit.message).toMatch(/single term/i);
  });

  it('refuses a logarithmic fit through a non-positive term', () => {
    const fit = fitSeries([0n, 1n, 2n], { logSpace: true });
    expect(fit.ok).toBe(false);
    if (fit.ok) return;
    expect(fit.message).toMatch(/positive/i);
  });

  it('fits the classic 27 path on a linear axis as a rough envelope', () => {
    const trajectory = hailstone(27n, 10_000);
    const fit = fitSeries(trajectory.values, { logSpace: false });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.expression.startsWith('value ≈')).toBe(true);
    expect(fit.substitution).toMatch(/iteration/);
    expect(fit.r2).toBeGreaterThan(0.4);
    expect(fit.r2).toBeLessThan(0.55);
    expect(fit.note).toMatch(/rough envelope/i);
    expect(fit.note).toMatch(/logarithmic axis/i);
    const peakAt = trajectory.values.indexOf(9232n);
    expect(Number.isFinite(fit.predict(peakAt))).toBe(true);
    expect(fit.predict(peakAt)).toBeGreaterThan(1000);
  });

  it('fits 27 more closely in log space, matching a logarithmic axis', () => {
    const trajectory = hailstone(27n, 10_000);
    const fit = fitSeries(trajectory.values, { logSpace: true });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.expression.startsWith('log₁₀(value) ≈')).toBe(true);
    expect(fit.summary).toMatch(/log₁₀/);
    expect(fit.r2).toBeGreaterThan(0.8);
    expect(fit.predict(0)).toBeGreaterThan(1);
    expect(fit.predict(trajectory.values.length - 1)).toBeGreaterThan(0);
  });
});

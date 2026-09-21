/** Largest value that still converts to a finite JavaScript number. */
const MAX_PLOT_VALUE = 10n ** 308n;

export interface Trajectory {
  seed: bigint;
  /** Terms from the seed through the stopping value, inclusive. */
  values: bigint[];
  reachedOne: boolean;
  /** Stopped because the next term would not fit on a numeric chart. */
  stoppedForSize: boolean;
}

export function hailstone(seed: bigint, maxIterations: number): Trajectory {
  const values: bigint[] = [seed];
  if (seed === 1n) {
    return { seed, values, reachedOne: true, stoppedForSize: false };
  }
  if (seed > MAX_PLOT_VALUE) {
    return { seed, values, reachedOne: false, stoppedForSize: true };
  }

  let current = seed;
  let steps = 0;
  while (current !== 1n && steps < maxIterations) {
    const next = (current & 1n) === 0n ? current / 2n : 3n * current + 1n;
    if (next > MAX_PLOT_VALUE) {
      return { seed, values, reachedOne: false, stoppedForSize: true };
    }
    current = next;
    values.push(current);
    steps += 1;
  }

  return {
    seed,
    values,
    reachedOne: current === 1n,
    stoppedForSize: false,
  };
}

export function peakValue(values: readonly bigint[]): bigint {
  let peak = values[0] ?? 0n;
  for (const value of values) {
    if (value > peak) peak = value;
  }
  return peak;
}

export function exceedsSafeInteger(values: readonly bigint[]): boolean {
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  return values.some((value) => value > limit);
}

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

export interface CommonValueHit {
  seed: bigint;
  /** First step in that seed’s sequence where {@link FirstCommonValue.value} appears. */
  index: number;
}

export interface FirstCommonValue {
  /**
   * Shared term every sequence has reached, other than 1 when anything else is shared.
   * Null when they meet only at 1, or when the computed runs share no term.
   */
  value: bigint | null;
  /** 1 is the only term present in every sequence. */
  onlyAtOne: boolean;
  /** No term appears in every sequence (a cap stopped them before they met). */
  none: boolean;
  /** One entry per trajectory, in plot order. Empty when there is no highlighted value. */
  hits: CommonValueHit[];
}

/**
 * Earliest value shared by every trajectory.
 *
 * For each value V that occurs in all sequences, take the first index of V in
 * each sequence and then the maximum of those indexes. The first common value
 * is the V with the smallest maximum: the earliest step by which every path
 * has landed on that number. Ties use the smallest sum of indexes, then the
 * smaller value. 1 is left out of that choice when any other shared term exists.
 * Returns null when fewer than two trajectories are given.
 */
export function firstCommonValue(series: readonly Trajectory[]): FirstCommonValue | null {
  if (series.length < 2) return null;
  const maps = series.map((trajectory) => firstIndexes(trajectory.values));
  let shared = [...maps[0].keys()];
  for (let i = 1; i < maps.length; i++) {
    const present = maps[i];
    shared = shared.filter((value) => present.has(value));
  }
  const others = shared.filter((value) => value !== 1n);
  if (shared.length === 0) return { value: null, onlyAtOne: false, none: true, hits: [] };
  if (others.length === 0) return { value: null, onlyAtOne: true, none: false, hits: [] };

  let bestValue = others[0];
  let bestMax = Number.POSITIVE_INFINITY;
  let bestSum = Number.POSITIVE_INFINITY;
  for (const value of others) {
    let maxIndex = 0;
    let sumIndex = 0;
    for (const indexes of maps) {
      const index = indexes.get(value) ?? 0;
      if (index > maxIndex) maxIndex = index;
      sumIndex += index;
    }
    const better =
      maxIndex < bestMax ||
      (maxIndex === bestMax && sumIndex < bestSum) ||
      (maxIndex === bestMax && sumIndex === bestSum && value < bestValue);
    if (better) {
      bestValue = value;
      bestMax = maxIndex;
      bestSum = sumIndex;
    }
  }

  return {
    value: bestValue,
    onlyAtOne: false,
    none: false,
    hits: series.map((trajectory, index) => ({
      seed: trajectory.seed,
      index: maps[index].get(bestValue) ?? 0,
    })),
  };
}

function firstIndexes(values: readonly bigint[]): Map<bigint, number> {
  const indexes = new Map<bigint, number>();
  values.forEach((value, index) => {
    if (!indexes.has(value)) indexes.set(value, index);
  });
  return indexes;
}

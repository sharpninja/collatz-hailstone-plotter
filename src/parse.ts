export const MAX_SEEDS = 12;
export const MAX_SEED_DIGITS = 120;
export const MAX_ITERATION_CAP = 200_000;
export const TOTAL_STEP_BUDGET = 500_000;

export interface ParsedSeeds {
  seeds: bigint[];
  rejected: string[];
  duplicates: number;
  /** Valid seeds dropped because only {@link MAX_SEEDS} are plotted. */
  omitted: number;
}

export function parseSeeds(text: string): ParsedSeeds {
  const tokens = text.match(/[^\s,]+/g) ?? [];
  const seeds: bigint[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let omitted = 0;

  for (const token of tokens) {
    if (!/^\d+$/.test(token)) {
      rejected.push(token);
      continue;
    }
    const value = BigInt(token);
    const key = value.toString();
    if (value < 1n || key.length > MAX_SEED_DIGITS) {
      rejected.push(token);
      continue;
    }
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    if (seeds.length >= MAX_SEEDS) {
      omitted += 1;
      continue;
    }
    seeds.push(value);
  }

  return { seeds, rejected, duplicates, omitted };
}

/** Positive integer within the iteration cap, or null when the field is unusable. */
export function parseMaxIterations(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ITERATION_CAP) return null;
  return value;
}

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
  /**
   * Distinct seeds a range expansion would produce when that count is above
   * {@link MAX_SEEDS}. `seeds` is empty in that case so nothing is plotted.
   * A list of individual numbers still truncates via `omitted`.
   */
  overflow: bigint | null;
  /** Ranges written high-to-low and read from the smaller end upward. */
  reversed: number;
}

const TOKEN = /(\d+\s*(?:\.{2,3}|-)\s*\d+)|([^\s,]+)/g;
const RANGE = /^(\d+)\s*(?:\.{2,3}|-)\s*(\d+)$/;

interface RangePiece {
  kind: 'range';
  lo: bigint;
  hi: bigint;
}

interface NumberPiece {
  kind: 'num';
  value: bigint;
}

type Piece = RangePiece | NumberPiece;

export function parseSeeds(text: string): ParsedSeeds {
  const rejected: string[] = [];
  const pieces: Piece[] = [];
  let reversed = 0;
  let sawRange = false;

  for (const token of tokenize(text)) {
    const range = readRange(token);
    if (range === 'bad') {
      rejected.push(token);
      continue;
    }
    if (range) {
      sawRange = true;
      reversed += range.reversed ? 1 : 0;
      pieces.push({ kind: 'range', lo: range.lo, hi: range.hi });
      continue;
    }
    if (!/^\d+$/.test(token)) {
      rejected.push(token);
      continue;
    }
    const value = BigInt(token);
    if (!acceptableSeed(value)) {
      rejected.push(token);
      continue;
    }
    pieces.push({ kind: 'num', value });
  }

  if (!sawRange) return parseIndividuals(pieces, rejected);

  const distinct = mergedCount(pieces);
  if (distinct > BigInt(MAX_SEEDS)) {
    return { seeds: [], rejected, duplicates: 0, omitted: 0, overflow: distinct, reversed };
  }

  const expanded = expandInOrder(pieces);
  return { seeds: expanded.seeds, rejected, duplicates: expanded.duplicates, omitted: 0, overflow: null, reversed };
}

/** Positive integer within the iteration cap, or null when the field is unusable. */
export function parseMaxIterations(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ITERATION_CAP) return null;
  return value;
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(TOKEN)) {
    tokens.push(match[1] ?? match[2]);
  }
  return tokens;
}

function readRange(token: string): { lo: bigint; hi: bigint; reversed: boolean } | 'bad' | null {
  const match = RANGE.exec(token);
  if (!match) return null;
  let lo = BigInt(match[1]);
  let hi = BigInt(match[2]);
  if (!acceptableSeed(lo) || !acceptableSeed(hi)) return 'bad';
  const reversed = lo > hi;
  if (reversed) {
    const swap = lo;
    lo = hi;
    hi = swap;
  }
  return { lo, hi, reversed };
}

function acceptableSeed(value: bigint): boolean {
  return value >= 1n && value.toString().length <= MAX_SEED_DIGITS;
}

/** Inclusive ranges and single seeds, merged so overlaps are counted once. */
function mergedCount(pieces: Piece[]): bigint {
  const intervals = pieces.map((piece) =>
    piece.kind === 'num' ? ([piece.value, piece.value] as const) : ([piece.lo, piece.hi] as const),
  );
  intervals.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));

  let total = 0n;
  let index = 0;
  while (index < intervals.length) {
    let end = intervals[index][1];
    const start = intervals[index][0];
    index += 1;
    while (index < intervals.length && intervals[index][0] <= end + 1n) {
      if (intervals[index][1] > end) end = intervals[index][1];
      index += 1;
    }
    total += end - start + 1n;
  }
  return total;
}

/**
 * First-seen order. A range contributes its integers from the lower end to
 * the higher end. Only called when the distinct count is within {@link MAX_SEEDS},
 * so no range is long enough to walk a huge span.
 */
function expandInOrder(pieces: Piece[]): { seeds: bigint[]; duplicates: number } {
  const seeds: bigint[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const piece of pieces) {
    if (piece.kind === 'num') {
      duplicates += remember(piece.value, seeds, seen);
      continue;
    }
    for (let current = piece.lo; current <= piece.hi; current += 1n) {
      duplicates += remember(current, seeds, seen);
    }
  }

  return { seeds, duplicates };
}

function remember(value: bigint, seeds: bigint[], seen: Set<string>): number {
  const key = value.toString();
  if (seen.has(key)) return 1;
  seen.add(key);
  seeds.push(value);
  return 0;
}

function parseIndividuals(pieces: Piece[], rejected: string[]): ParsedSeeds {
  const seeds: bigint[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let omitted = 0;

  for (const piece of pieces) {
    if (piece.kind !== 'num') continue;
    const key = piece.value.toString();
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    if (seeds.length >= MAX_SEEDS) {
      omitted += 1;
      continue;
    }
    seeds.push(piece.value);
  }

  return { seeds, rejected, duplicates, omitted, overflow: null, reversed: 0 };
}

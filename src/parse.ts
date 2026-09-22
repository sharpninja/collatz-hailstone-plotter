export const MAX_SEEDS = 12;
export const MAX_SEED_DIGITS = 120;
export const MAX_ITERATION_CAP = 200_000;
export const TOTAL_STEP_BUDGET = 500_000;

/**
 * Inclusive prime ranges at or below this endpoint are counted with a sieve.
 * Wider big-integer windows are checked directly, and still larger spans are
 * refused or rejected as over the seed cap without walking every integer.
 */
const PRIME_SIEVE_LIMIT = 10_000_000;
/** Widest big-integer window checked one candidate at a time. */
const PRIME_SCAN_LIMIT = 2_000;
/** Odd candidates examined while proving a wide range exceeds the seed cap. */
const PRIME_SEARCH_BUDGET = 4_000;

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
  /** Prime ranges with no prime ≥ 2, written `lo..hi` after swapping reversed bounds. */
  emptyPrimes: string[];
  /** Prime ranges that were too wide to check. */
  tooWide: string[];
  /**
   * More than {@link MAX_SEEDS} seeds, but the exact size was not counted.
   * `seeds` is empty. Used when a prime range sits past the sieve.
   */
  overCap: boolean;
}

const RANGE = /^(\d+)\s*(?:\.{2,3}|-)\s*(\d+)$/;
const PRIMES = /^(?:primes|p)\s*(?::\s*|\s+)(\d+)\s*(?:\.{2,3}|-)\s*(\d+)$/i;

interface RangePiece {
  kind: 'range';
  lo: bigint;
  hi: bigint;
}

interface NumberPiece {
  kind: 'num';
  value: bigint;
}

interface PrimesPiece {
  kind: 'primes';
  lo: bigint;
  hi: bigint;
  label: string;
}

type IntegerPiece = RangePiece | NumberPiece;
type Piece = IntegerPiece | PrimesPiece;
type Interval = readonly [bigint, bigint];

interface PrimeCensus {
  count: bigint | null;
  overCap: boolean;
  tooWide: boolean;
}

const NO_PRIMES: PrimeCensus = { count: 0n, overCap: false, tooWide: false };

export function parseSeeds(text: string): ParsedSeeds {
  const rejected: string[] = [];
  const pieces: Piece[] = [];
  let reversed = 0;
  let sawExpansion = false;
  const emptyPrimes: string[] = [];
  const tooWide: string[] = [];
  const census = cachedCensus();

  for (const token of tokenize(text)) {
    const primes = readPrimes(token);
    if (primes === 'bad') {
      rejected.push(token);
      continue;
    }
    if (primes) {
      sawExpansion = true;
      reversed += primes.reversed ? 1 : 0;
      const found = census(primes.lo, primes.hi);
      if (found.tooWide) tooWide.push(primes.label);
      else if (!found.overCap && found.count === 0n) emptyPrimes.push(primes.label);
      pieces.push({ kind: 'primes', lo: primes.lo, hi: primes.hi, label: primes.label });
      continue;
    }

    const range = readRange(token);
    if (range === 'bad') {
      rejected.push(token);
      continue;
    }
    if (range) {
      sawExpansion = true;
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

  const base = {
    seeds: [] as bigint[],
    rejected,
    duplicates: 0,
    omitted: 0,
    overflow: null as bigint | null,
    reversed,
    emptyPrimes,
    tooWide: [] as string[],
    overCap: false,
  };

  // An empty prime range is an error on its own, so nothing else in the field is plotted.
  if (emptyPrimes.length > 0) return base;
  if (tooWide.length > 0) return { ...base, tooWide };

  if (!sawExpansion) return parseIndividuals(pieces, rejected);

  const distinct = distinctCensus(pieces, census);
  if (distinct.tooWide) {
    const labels = pieces.filter((piece): piece is PrimesPiece => piece.kind === 'primes').map((piece) => piece.label);
    return { ...base, tooWide: labels };
  }
  if (distinct.overCap) return { ...base, overCap: true };
  if (distinct.count > BigInt(MAX_SEEDS)) return { ...base, overflow: distinct.count };

  const expanded = expandInOrder(pieces);
  return { ...base, seeds: expanded.seeds, duplicates: expanded.duplicates };
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
  // `primes:10..50`, `p:10..50`, and `primes 10..50` are one token, before a plain `10..50`.
  const token =
    /(?:primes|p)\s*:\s*\d+\s*(?:\.{2,3}|-)\s*\d+|(?:primes|p)\s+\d+\s*(?:\.{2,3}|-)\s*\d+|\d+\s*(?:\.{2,3}|-)\s*\d+|[^\s,]+/gi;
  return [...text.matchAll(token)].map((match) => match[0]);
}

function readPrimes(token: string): { lo: bigint; hi: bigint; reversed: boolean; label: string } | 'bad' | null {
  const match = PRIMES.exec(token);
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
  return { lo, hi, reversed, label: `${lo}..${hi}` };
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

function cachedCensus(): (lo: bigint, hi: bigint) => PrimeCensus {
  const cache = new Map<string, PrimeCensus>();
  return (lo, hi) => {
    const key = `${lo}:${hi}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const found = censusPrimes(lo, hi);
    cache.set(key, found);
    return found;
  };
}

/** Inclusive distinct count of integers plus primes that fall outside those integers. */
function distinctCensus(
  pieces: Piece[],
  census: (lo: bigint, hi: bigint) => PrimeCensus,
): { count: bigint; overCap: boolean; tooWide: boolean } {
  const integers = pieces.filter((piece): piece is IntegerPiece => piece.kind !== 'primes');
  const primeIntervals: Interval[] = pieces
    .filter((piece): piece is PrimesPiece => piece.kind === 'primes')
    .map((piece) => [piece.lo, piece.hi]);
  const cover = mergeIntervals(
    integers.map((piece) => (piece.kind === 'num' ? [piece.value, piece.value] : [piece.lo, piece.hi])),
  );
  let extra = 0n;
  for (const [lo, hi] of mergeIntervals(primeIntervals)) {
    for (const [start, end] of subtractInterval(lo, hi, cover)) {
      const found = census(start, end);
      if (found.tooWide) return { count: 0n, overCap: false, tooWide: true };
      if (found.overCap || found.count === null) return { count: 0n, overCap: true, tooWide: false };
      extra += found.count;
    }
  }
  return { count: mergedCount(integers) + extra, overCap: false, tooWide: false };
}

function censusPrimes(lo: bigint, hi: bigint): PrimeCensus {
  if (hi < lo || hi < 2n) return NO_PRIMES;
  const start = lo < 2n ? 2n : lo;
  if (start > hi) return NO_PRIMES;

  if (hi <= BigInt(PRIME_SIEVE_LIMIT)) {
    return { count: BigInt(sieveCount(Number(start), Number(hi))), overCap: false, tooWide: false };
  }
  if (hi - start <= BigInt(PRIME_SCAN_LIMIT)) {
    const found = scanPrimes(start, hi, Number.MAX_SAFE_INTEGER, PRIME_SCAN_LIMIT + 2);
    return { count: BigInt(found.primes.length), overCap: false, tooWide: false };
  }
  // Bertrand's postulate: a prime lies strictly between m and 2m, so a long
  // span from a small start is over the seed cap with no primality tests.
  if (bertrandLowerBound(start, hi) > MAX_SEEDS) {
    return { count: null, overCap: true, tooWide: false };
  }
  const found = scanPrimes(start, hi, MAX_SEEDS + 1, PRIME_SEARCH_BUDGET);
  if (found.primes.length > MAX_SEEDS) return { count: null, overCap: true, tooWide: false };
  if (found.finished) return { count: BigInt(found.primes.length), overCap: false, tooWide: false };
  return { count: null, overCap: false, tooWide: true };
}

/** At least this many primes in [lo, hi], or a smaller under-count. Never over-counts. */
function bertrandLowerBound(lo: bigint, hi: bigint): number {
  let m = lo < 2n ? 2n : lo;
  let count = 0;
  while (count <= MAX_SEEDS && 2n * m - 1n <= hi) {
    count += 1;
    m *= 2n;
  }
  return count;
}

function listPrimes(lo: bigint, hi: bigint): bigint[] {
  if (hi < lo || hi < 2n) return [];
  const start = lo < 2n ? 2n : lo;
  if (start > hi) return [];
  if (hi <= BigInt(PRIME_SIEVE_LIMIT)) return sieveList(Number(start), Number(hi));
  // Expansion only runs when the distinct total fits the seed cap, so this
  // window holds at most MAX_SEEDS primes and is short enough to scan.
  return scanPrimes(start, hi, Number.MAX_SAFE_INTEGER, PRIME_SCAN_LIMIT + 2).primes;
}

function sieve(hi: number): Uint8Array {
  const composite = new Uint8Array(hi + 1);
  composite[0] = 1;
  if (hi >= 1) composite[1] = 1;
  for (let p = 2; p * p <= hi; p++) {
    if (composite[p]) continue;
    for (let q = p * p; q <= hi; q += p) composite[q] = 1;
  }
  return composite;
}

function sieveCount(lo: number, hi: number): number {
  const composite = sieve(hi);
  let count = 0;
  for (let i = Math.max(lo, 2); i <= hi; i++) if (composite[i] === 0) count += 1;
  return count;
}

function sieveList(lo: number, hi: number): bigint[] {
  const composite = sieve(hi);
  const primes: bigint[] = [];
  for (let i = Math.max(lo, 2); i <= hi; i++) if (composite[i] === 0) primes.push(BigInt(i));
  return primes;
}

function scanPrimes(
  start: bigint,
  hi: bigint,
  stopAt: number,
  budget: number,
): { primes: bigint[]; finished: boolean } {
  const primes: bigint[] = [];
  let checked = 0;
  let current = start;

  if (current <= 2n && hi >= 2n && checked < budget && primes.length < stopAt) {
    primes.push(2n);
    checked += 1;
    current = 3n;
  }
  if (current < 3n) current = 3n;
  if (current < start) current = start;
  if ((current & 1n) === 0n) current += 1n;

  while (current <= hi && primes.length < stopAt && checked < budget) {
    if (isPrime(current)) primes.push(current);
    checked += 1;
    current += 2n;
  }
  return { primes, finished: current > hi };
}

const TRIAL_PRIMES = [5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n];

/** Deterministic Miller–Rabin below 2^64, and the same fixed bases above that. */
function isPrime(n: bigint): boolean {
  if (n < 2n) return false;
  if (n === 2n || n === 3n) return true;
  if (n % 2n === 0n || n % 3n === 0n) return false;
  for (const p of TRIAL_PRIMES) {
    if (p * p > n) return true;
    if (n % p === 0n) return false;
  }

  let d = n - 1n;
  let s = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s += 1;
  }
  for (const a of witnesses(n)) {
    if (!millerRabinPass(n, d, s, a)) return false;
  }
  return true;
}

function witnesses(n: bigint): readonly bigint[] {
  if (n < 2047n) return [2n];
  if (n < 1373653n) return [2n, 3n];
  if (n < 9080191n) return [31n, 73n];
  if (n < 25326001n) return [2n, 3n, 5n];
  if (n < 3215031751n) return [2n, 3n, 5n, 7n];
  if (n < 4759123141n) return [2n, 7n, 61n];
  if (n < 1122004669633n) return [2n, 13n, 23n, 1662803n];
  if (n < 2152302898747n) return [2n, 3n, 5n, 7n, 11n];
  if (n < 3474749660383n) return [2n, 3n, 5n, 7n, 11n, 13n];
  if (n < 341550071728321n) return [2n, 3n, 5n, 7n, 11n, 13n, 17n];
  if (n < 3825123056546413051n) return [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n];
  return [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
}

function millerRabinPass(n: bigint, d: bigint, s: number, a: bigint): boolean {
  let x = modPow(a, d, n);
  if (x === 1n || x === n - 1n) return true;
  for (let r = 1; r < s; r++) {
    x = (x * x) % n;
    if (x === n - 1n) return true;
  }
  return false;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    e >>= 1n;
    if (e > 0n) b = (b * b) % mod;
  }
  return result;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const merged: Interval[] = [];
  let start = sorted[0][0];
  let end = sorted[0][1];
  for (let i = 1; i < sorted.length; i++) {
    const [nextStart, nextEnd] = sorted[i];
    if (nextStart <= end + 1n) {
      if (nextEnd > end) end = nextEnd;
    } else {
      merged.push([start, end]);
      start = nextStart;
      end = nextEnd;
    }
  }
  merged.push([start, end]);
  return merged;
}

/** Portions of [lo, hi] that are not covered by `cover` (merged, ascending). */
function subtractInterval(lo: bigint, hi: bigint, cover: Interval[]): Interval[] {
  const result: Interval[] = [];
  let cursor = lo;
  for (const [start, end] of cover) {
    if (end < cursor) continue;
    if (start > hi) break;
    if (start > cursor) {
      const gapEnd = start - 1n < hi ? start - 1n : hi;
      result.push([cursor, gapEnd]);
    }
    if (end + 1n > cursor) cursor = end + 1n;
    if (cursor > hi) break;
  }
  if (cursor <= hi) result.push([cursor, hi]);
  return result;
}

/** Inclusive ranges and single seeds, merged so overlaps are counted once. */
function mergedCount(pieces: IntegerPiece[]): bigint {
  return mergeIntervals(
    pieces.map((piece) => (piece.kind === 'num' ? [piece.value, piece.value] : [piece.lo, piece.hi])),
  ).reduce((total, [start, end]) => total + (end - start + 1n), 0n);
}

/**
 * First-seen order. A range contributes its integers from the lower end to
 * the higher end. A prime range contributes primes the same way. Only called
 * when the distinct count is within {@link MAX_SEEDS}.
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
    if (piece.kind === 'range') {
      for (let current = piece.lo; current <= piece.hi; current += 1n) {
        duplicates += remember(current, seeds, seen);
      }
      continue;
    }
    for (const prime of listPrimes(piece.lo, piece.hi)) {
      duplicates += remember(prime, seeds, seen);
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

  return { seeds, rejected, duplicates, omitted, overflow: null, reversed: 0, emptyPrimes: [], tooWide: [], overCap: false };
}

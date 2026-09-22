export const MAX_SEEDS = 12;
/** Highest value the Max seeds control accepts. */
export const MAX_SEEDS_LIMIT = 50_000;
/** Chosen caps above this still plot, and the page warns that drawing will be slow. */
export const SEED_CROWD_WARN = 2_000;
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
  /** Valid seeds dropped because only the active cap are plotted. */
  omitted: number;
  /**
   * Distinct seeds a range expansion would produce when that count is above
   * the active cap (default {@link MAX_SEEDS}). `seeds` is empty in that case
   * so nothing is plotted. A list of individual numbers still truncates via `omitted`.
   */
  overflow: bigint | null;
  /** Ranges written high-to-low and read from the smaller end upward. */
  reversed: number;
  /** Prime ranges with no prime ≥ 2, written `lo..hi` after swapping reversed bounds. */
  emptyPrimes: string[];
  /** Prime-power ranges with no p^k for k ≥ 2, written `lo..hi` after swapping. */
  emptyPrimePowers: string[];
  /** Odd-exponent prime-power ranges with nothing in range, written `lo..hi` after swapping. */
  emptyOddPrimePowers: string[];
  /** Prime ranges that were too wide to check. */
  tooWide: string[];
  /** Prime-power ranges that were too wide to check. */
  tooWidePowers: string[];
  /** Odd-exponent prime-power ranges that were too wide to check. */
  tooWideOddPowers: string[];
  /**
   * More than the active cap, but the exact size was not counted.
   * `seeds` is empty. Used when a prime range sits past the sieve.
   */
  overCap: boolean;
  /**
   * Every plotted seed came from a prime range, with no mixed numbers or
   * ordinary ranges. Used to describe those primes' parity forms.
   */
  primeOnly: boolean;
  /**
   * Every plotted seed came from a prime-power range (p^k, k ≥ 2).
   * Used to describe those seeds' parity forms.
   */
  primePowerOnly: boolean;
  /**
   * Every plotted seed came from an odd-exponent prime-power range
   * (p^k with k odd, including primes as p^1).
   */
  oddPrimePowerOnly: boolean;
}

const RANGE = /^(\d+)\s*(?:\.{2,3}|-)\s*(\d+)$/;
const PRIMES = /^(?:primes|p)\s*(?::\s*|\s+)(\d+)\s*(?:\.{2,3}|-)\s*(\d+)$/i;
const PRIME_POWERS = /^(?:primepowers|pp)\s*(?::\s*|\s+)(\d+)\s*(?:\.{2,3}|-)\s*(\d+)$/i;
const ODD_PRIME_POWERS = /^(?:oddprimepowers|ppodd)\s*(?::\s*|\s+)(\d+)\s*(?:\.{2,3}|-)\s*(\d+)$/i;

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

interface PrimePowersPiece {
  kind: 'powers';
  lo: bigint;
  hi: bigint;
  label: string;
}

interface OddPrimePowersPiece {
  kind: 'odd-powers';
  lo: bigint;
  hi: bigint;
  label: string;
}

type IntegerPiece = RangePiece | NumberPiece;
type SpecialPiece = PrimesPiece | PrimePowersPiece | OddPrimePowersPiece;
type Piece = IntegerPiece | SpecialPiece;
type Interval = readonly [bigint, bigint];

interface PrimeCensus {
  count: bigint | null;
  overCap: boolean;
  tooWide: boolean;
}

const NO_PRIMES: PrimeCensus = { count: 0n, overCap: false, tooWide: false };

/**
 * Parse starting values. `maxSeeds` is how many distinct seeds may be plotted
 * (default {@link MAX_SEEDS}, at most {@link MAX_SEEDS_LIMIT}). A range that
 * expands past that cap is refused. A bare list keeps the first seeds and
 * counts the rest in `omitted`.
 */
export function parseSeeds(text: string, maxSeeds: number = MAX_SEEDS): ParsedSeeds {
  const limit = clampSeedLimit(maxSeeds);
  const rejected: string[] = [];
  const pieces: Piece[] = [];
  let reversed = 0;
  let sawExpansion = false;
  const emptyPrimes: string[] = [];
  const emptyPrimePowers: string[] = [];
  const emptyOddPrimePowers: string[] = [];
  const tooWide: string[] = [];
  const tooWidePowers: string[] = [];
  const tooWideOddPowers: string[] = [];
  const primeCensus = cachedCensus((lo, hi) => censusPrimes(lo, hi, limit));
  const powerCensus = cachedCensus((lo, hi) => censusPrimePowers(lo, hi, limit));
  const oddCensus = cachedCensus((lo, hi) => censusOddPrimePowers(lo, hi, limit));
  const oddHigherCensus = cachedCensus((lo, hi) => censusOddHigherPowers(lo, hi, limit));

  for (const token of tokenize(text)) {
    const oddPowers = readBounded(token, ODD_PRIME_POWERS);
    if (oddPowers === 'bad') {
      rejected.push(token);
      continue;
    }
    if (oddPowers) {
      sawExpansion = true;
      reversed += oddPowers.reversed ? 1 : 0;
      const found = oddCensus(oddPowers.lo, oddPowers.hi);
      if (found.tooWide) tooWideOddPowers.push(oddPowers.label);
      else if (!found.overCap && found.count === 0n) emptyOddPrimePowers.push(oddPowers.label);
      pieces.push({ kind: 'odd-powers', lo: oddPowers.lo, hi: oddPowers.hi, label: oddPowers.label });
      continue;
    }

    const powers = readBounded(token, PRIME_POWERS);
    if (powers === 'bad') {
      rejected.push(token);
      continue;
    }
    if (powers) {
      sawExpansion = true;
      reversed += powers.reversed ? 1 : 0;
      const found = powerCensus(powers.lo, powers.hi);
      if (found.tooWide) tooWidePowers.push(powers.label);
      else if (!found.overCap && found.count === 0n) emptyPrimePowers.push(powers.label);
      pieces.push({ kind: 'powers', lo: powers.lo, hi: powers.hi, label: powers.label });
      continue;
    }

    const primes = readPrimes(token);
    if (primes === 'bad') {
      rejected.push(token);
      continue;
    }
    if (primes) {
      sawExpansion = true;
      reversed += primes.reversed ? 1 : 0;
      const found = primeCensus(primes.lo, primes.hi);
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
    emptyPrimePowers,
    emptyOddPrimePowers,
    tooWide: [] as string[],
    tooWidePowers: [] as string[],
    tooWideOddPowers: [] as string[],
    overCap: false,
    primeOnly: false,
    primePowerOnly: false,
    oddPrimePowerOnly: false,
  };

  // An empty special range is an error on its own, so nothing else is plotted.
  if (emptyPrimes.length > 0 || emptyPrimePowers.length > 0 || emptyOddPrimePowers.length > 0) return base;
  if (tooWide.length > 0 || tooWidePowers.length > 0 || tooWideOddPowers.length > 0) {
    return { ...base, tooWide, tooWidePowers, tooWideOddPowers };
  }

  if (!sawExpansion) return parseIndividuals(pieces, rejected, limit);

  const distinct = distinctCensus(pieces, primeCensus, powerCensus, oddCensus, oddHigherCensus);
  if (distinct.tooWide || distinct.tooWidePowers || distinct.tooWideOdd) {
    return {
      ...base,
      tooWide: distinct.tooWide ? labelsOf(pieces, 'primes') : [],
      tooWidePowers: distinct.tooWidePowers ? labelsOf(pieces, 'powers') : [],
      tooWideOddPowers: distinct.tooWideOdd ? labelsOf(pieces, 'odd-powers') : [],
    };
  }
  if (distinct.overCap) return { ...base, overCap: true };
  if (distinct.count > BigInt(limit)) return { ...base, overflow: distinct.count };

  const expanded = expandInOrder(pieces);
  const primeOnly = expanded.seeds.length > 0 && pieces.length > 0 && pieces.every((piece) => piece.kind === 'primes');
  const primePowerOnly = expanded.seeds.length > 0 && pieces.length > 0 && pieces.every((piece) => piece.kind === 'powers');
  const oddPrimePowerOnly =
    expanded.seeds.length > 0 && pieces.length > 0 && pieces.every((piece) => piece.kind === 'odd-powers');
  return {
    ...base,
    seeds: expanded.seeds,
    duplicates: expanded.duplicates,
    primeOnly,
    primePowerOnly,
    oddPrimePowerOnly,
  };
}

/** Whole number from 1 to {@link MAX_SEEDS_LIMIT}, or null when the field is unusable. */
export function parseMaxSeeds(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SEEDS_LIMIT) return null;
  return value;
}

function clampSeedLimit(maxSeeds: number): number {
  if (!Number.isInteger(maxSeeds) || maxSeeds < 1) return MAX_SEEDS;
  return Math.min(maxSeeds, MAX_SEEDS_LIMIT);
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
  // Odd-exponent forms come first so `ppodd` is not split as `pp`, and `oddprimepowers`
  // is not split as `primepowers`. Those come before `p:` / `primes`, then a plain `10..50`.
  const token =
    /(?:oddprimepowers|ppodd)\s*:\s*\d+\s*(?:\.{2,3}|-)\s*\d+|(?:oddprimepowers|ppodd)\s+\d+\s*(?:\.{2,3}|-)\s*\d+|(?:primepowers|pp)\s*:\s*\d+\s*(?:\.{2,3}|-)\s*\d+|(?:primepowers|pp)\s+\d+\s*(?:\.{2,3}|-)\s*\d+|(?:primes|p)\s*:\s*\d+\s*(?:\.{2,3}|-)\s*\d+|(?:primes|p)\s+\d+\s*(?:\.{2,3}|-)\s*\d+|\d+\s*(?:\.{2,3}|-)\s*\d+|[^\s,]+/gi;
  return [...text.matchAll(token)].map((match) => match[0]);
}

function readPrimes(token: string): { lo: bigint; hi: bigint; reversed: boolean; label: string } | 'bad' | null {
  return readBounded(token, PRIMES);
}

function readBounded(
  token: string,
  pattern: RegExp,
): { lo: bigint; hi: bigint; reversed: boolean; label: string } | 'bad' | null {
  const match = pattern.exec(token);
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

function labelsOf(pieces: Piece[], kind: SpecialPiece['kind']): string[] {
  return pieces.filter((piece): piece is SpecialPiece => piece.kind === kind).map((piece) => piece.label);
}

function cachedCensus(
  compute: (lo: bigint, hi: bigint) => PrimeCensus,
): (lo: bigint, hi: bigint) => PrimeCensus {
  const cache = new Map<string, PrimeCensus>();
  return (lo, hi) => {
    const key = `${lo}:${hi}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const found = compute(lo, hi);
    cache.set(key, found);
    return found;
  };
}

interface DistinctCensus {
  count: bigint;
  overCap: boolean;
  tooWide: boolean;
  tooWidePowers: boolean;
  tooWideOdd: boolean;
}

/**
 * Inclusive distinct count of integers plus primes and prime powers outside those integers.
 * Primes sit in both a primes range and an odd-exponent range, and p^k for odd k ≥ 3 sits
 * in both a prime-power range and an odd-exponent range, so those overlaps are subtracted once.
 */
function distinctCensus(
  pieces: Piece[],
  primeCensus: (lo: bigint, hi: bigint) => PrimeCensus,
  powerCensus: (lo: bigint, hi: bigint) => PrimeCensus,
  oddCensus: (lo: bigint, hi: bigint) => PrimeCensus,
  oddHigherCensus: (lo: bigint, hi: bigint) => PrimeCensus,
): DistinctCensus {
  const integers = pieces.filter((piece): piece is IntegerPiece => piece.kind === 'num' || piece.kind === 'range');
  const cover = mergeIntervals(
    integers.map((piece) => (piece.kind === 'num' ? [piece.value, piece.value] : [piece.lo, piece.hi])),
  );
  const none: DistinctCensus = {
    count: 0n,
    overCap: false,
    tooWide: false,
    tooWidePowers: false,
    tooWideOdd: false,
  };
  const primeExtra = countOutside(pieces, 'primes', cover, primeCensus);
  if (primeExtra === 'tooWide') return { ...none, tooWide: true };
  if (primeExtra === 'overCap') return { ...none, overCap: true };
  const powerExtra = countOutside(pieces, 'powers', cover, powerCensus);
  if (powerExtra === 'tooWide') return { ...none, tooWidePowers: true };
  if (powerExtra === 'overCap') return { ...none, overCap: true };
  const oddExtra = countOutside(pieces, 'odd-powers', cover, oddCensus);
  if (oddExtra === 'tooWide') return { ...none, tooWideOdd: true };
  if (oddExtra === 'overCap') return { ...none, overCap: true };

  const primeIntervals = mergeIntervals(intervalsOf(pieces, 'primes'));
  const powerIntervals = mergeIntervals(intervalsOf(pieces, 'powers'));
  const oddIntervals = mergeIntervals(intervalsOf(pieces, 'odd-powers'));
  const primeOverlap = countInIntervals(intersectIntervals(primeIntervals, oddIntervals), cover, primeCensus);
  if (primeOverlap === 'tooWide') return { ...none, tooWide: true };
  if (primeOverlap === 'overCap') return { ...none, overCap: true };
  const higherOverlap = countInIntervals(intersectIntervals(powerIntervals, oddIntervals), cover, oddHigherCensus);
  if (higherOverlap === 'tooWide') return { ...none, tooWideOdd: true };
  if (higherOverlap === 'overCap') return { ...none, overCap: true };

  return {
    count: mergedCount(integers) + primeExtra + powerExtra + oddExtra - primeOverlap - higherOverlap,
    overCap: false,
    tooWide: false,
    tooWidePowers: false,
    tooWideOdd: false,
  };
}

function intervalsOf(pieces: Piece[], kind: SpecialPiece['kind']): Interval[] {
  return pieces.filter((piece): piece is SpecialPiece => piece.kind === kind).map((piece) => [piece.lo, piece.hi]);
}

function countOutside(
  pieces: Piece[],
  kind: SpecialPiece['kind'],
  cover: Interval[],
  census: (lo: bigint, hi: bigint) => PrimeCensus,
): bigint | 'tooWide' | 'overCap' {
  return countInIntervals(mergeIntervals(intervalsOf(pieces, kind)), cover, census);
}

function countInIntervals(
  intervals: Interval[],
  cover: Interval[],
  census: (lo: bigint, hi: bigint) => PrimeCensus,
): bigint | 'tooWide' | 'overCap' {
  let extra = 0n;
  for (const [lo, hi] of intervals) {
    for (const [start, end] of subtractInterval(lo, hi, cover)) {
      const found = census(start, end);
      if (found.tooWide) return 'tooWide';
      if (found.overCap || found.count === null) return 'overCap';
      extra += found.count;
    }
  }
  return extra;
}

function censusPrimes(lo: bigint, hi: bigint, limit: number): PrimeCensus {
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
  if (bertrandLowerBound(start, hi, limit) > limit) {
    return { count: null, overCap: true, tooWide: false };
  }
  const found = scanPrimes(start, hi, limit + 1, PRIME_SEARCH_BUDGET);
  if (found.primes.length > limit) return { count: null, overCap: true, tooWide: false };
  if (found.finished) return { count: BigInt(found.primes.length), overCap: false, tooWide: false };
  return { count: null, overCap: false, tooWide: true };
}

/**
 * p^k with k ≥ 2. Primes themselves are not included. 27 = 3^3 is.
 * Counted exactly up to the sieve limit; a long span of powers of two is
 * enough to know the seed cap is exceeded.
 */
function censusPrimePowers(lo: bigint, hi: bigint, limit: number): PrimeCensus {
  if (hi < lo || hi < 4n) return NO_PRIMES;
  const start = lo < 4n ? 4n : lo;
  if (start > hi) return NO_PRIMES;

  if (hi <= BigInt(PRIME_SIEVE_LIMIT)) {
    return { count: BigInt(primePowerCount(Number(start), Number(hi))), overCap: false, tooWide: false };
  }
  if (hi - start <= BigInt(PRIME_SCAN_LIMIT)) {
    const found = scanPrimePowers(start, hi, Number.MAX_SAFE_INTEGER);
    return { count: BigInt(found.powers.length), overCap: false, tooWide: false };
  }
  if (powersOfTwoInRange(start, hi, limit) > limit) {
    return { count: null, overCap: true, tooWide: false };
  }
  const found = scanPrimePowers(start, hi, limit + 1);
  if (found.powers.length > limit) return { count: null, overCap: true, tooWide: false };
  if (found.finished) return { count: BigInt(found.powers.length), overCap: false, tooWide: false };
  return { count: null, overCap: false, tooWide: true };
}

function listPrimePowers(lo: bigint, hi: bigint): bigint[] {
  if (hi < lo || hi < 4n) return [];
  const start = lo < 4n ? 4n : lo;
  if (start > hi) return [];
  if (hi <= BigInt(PRIME_SIEVE_LIMIT)) return primePowerList(Number(start), Number(hi));
  return scanPrimePowers(start, hi, Number.MAX_SAFE_INTEGER).powers;
}

function primePowerCount(lo: number, hi: number): number {
  return primePowerList(lo, hi).length;
}

function primePowerList(lo: number, hi: number): bigint[] {
  if (hi < 4 || hi < lo) return [];
  const root = Math.floor(Math.sqrt(hi));
  const composite = sieve(root);
  const powers: number[] = [];
  for (let p = 2; p <= root; p++) {
    if (composite[p]) continue;
    let value = p * p;
    while (value <= hi) {
      if (value >= lo) powers.push(value);
      if (value > Math.floor(hi / p)) break;
      value *= p;
    }
  }
  powers.sort((a, b) => a - b);
  return powers.map((value) => BigInt(value));
}

function powersOfTwoInRange(lo: bigint, hi: bigint, limit: number): number {
  if (hi < 4n || hi < lo) return 0;
  let value = 4n;
  if (lo > value) {
    const floorLog = lo.toString(2).length - 1;
    value = 1n << BigInt(floorLog);
    if (value < lo) value <<= 1n;
    if (value < 4n) value = 4n;
  }
  let count = 0;
  while (value <= hi && count <= limit + 1) {
    count += 1;
    if (value > hi >> 1n) break;
    value <<= 1n;
  }
  return count;
}

function scanPrimePowers(start: bigint, hi: bigint, stopAt: number): { powers: bigint[]; finished: boolean } {
  const powers: bigint[] = [];
  let current = start < 4n ? 4n : start;
  const budgetEnd = current + BigInt(PRIME_SEARCH_BUDGET);
  const end = hi - current > BigInt(PRIME_SEARCH_BUDGET) ? budgetEnd : hi;
  while (current <= end && powers.length < stopAt) {
    if (isPrimePower(current)) powers.push(current);
    current += 1n;
  }
  return { powers, finished: current > hi };
}

function isPrimePower(n: bigint): boolean {
  if (n < 4n) return false;
  const maxExp = n.toString(2).length - 1;
  for (let exp = 2; exp <= maxExp; exp++) {
    const root = integerRoot(n, exp);
    if (powEquals(root, exp, n) && isPrime(root)) return true;
  }
  return false;
}

/**
 * p^k with k odd: primes (k = 1) and higher odd powers such as 8 = 2^3, 27 = 3^3, 32 = 2^5.
 * Squares and other even exponents are not included.
 */
function censusOddPrimePowers(lo: bigint, hi: bigint, limit: number): PrimeCensus {
  if (hi < lo || hi < 2n) return NO_PRIMES;
  const start = lo < 2n ? 2n : lo;
  if (start > hi) return NO_PRIMES;

  if (hi <= BigInt(PRIME_SIEVE_LIMIT)) {
    return { count: BigInt(oddPrimePowerList(Number(start), Number(hi)).length), overCap: false, tooWide: false };
  }
  if (hi - start <= BigInt(PRIME_SCAN_LIMIT)) {
    const found = scanMatching(start, hi, Number.MAX_SAFE_INTEGER, isOddPrimePower);
    return { count: BigInt(found.values.length), overCap: false, tooWide: false };
  }
  if (bertrandLowerBound(start, hi, limit) > limit) {
    return { count: null, overCap: true, tooWide: false };
  }
  const found = scanMatching(start, hi, limit + 1, isOddPrimePower);
  if (found.values.length > limit) return { count: null, overCap: true, tooWide: false };
  if (found.finished) return { count: BigInt(found.values.length), overCap: false, tooWide: false };
  return { count: null, overCap: false, tooWide: true };
}

/** p^k with odd k ≥ 3. Used to subtract the overlap of a prime-power range and an odd-exponent range. */
function censusOddHigherPowers(lo: bigint, hi: bigint, limit: number): PrimeCensus {
  if (hi < lo || hi < 8n) return NO_PRIMES;
  const start = lo < 8n ? 8n : lo;
  if (start > hi) return NO_PRIMES;

  if (hi <= BigInt(PRIME_SIEVE_LIMIT)) {
    return { count: BigInt(oddHigherPowerList(Number(start), Number(hi)).length), overCap: false, tooWide: false };
  }
  if (hi - start <= BigInt(PRIME_SCAN_LIMIT)) {
    const found = scanMatching(start, hi, Number.MAX_SAFE_INTEGER, isOddHigherPrimePower);
    return { count: BigInt(found.values.length), overCap: false, tooWide: false };
  }
  if (oddPowersOfTwoInRange(start, hi, limit) > limit) {
    return { count: null, overCap: true, tooWide: false };
  }
  const found = scanMatching(start, hi, limit + 1, isOddHigherPrimePower);
  if (found.values.length > limit) return { count: null, overCap: true, tooWide: false };
  if (found.finished) return { count: BigInt(found.values.length), overCap: false, tooWide: false };
  return { count: null, overCap: false, tooWide: true };
}

function listOddPrimePowers(lo: bigint, hi: bigint): bigint[] {
  if (hi < lo || hi < 2n) return [];
  const start = lo < 2n ? 2n : lo;
  if (start > hi) return [];
  if (hi <= BigInt(PRIME_SIEVE_LIMIT)) return oddPrimePowerList(Number(start), Number(hi));
  return scanMatching(start, hi, Number.MAX_SAFE_INTEGER, isOddPrimePower).values;
}

function oddPrimePowerList(lo: number, hi: number): bigint[] {
  if (hi < 2 || hi < lo) return [];
  const composite = sieve(hi);
  const values: number[] = [];
  for (let p = 2; p <= hi; p++) {
    if (composite[p]) continue;
    if (p >= lo) values.push(p);
    let value = p;
    const step = p * p;
    while (value <= Math.floor(hi / step)) {
      value *= step;
      if (value >= lo) values.push(value);
    }
  }
  values.sort((a, b) => a - b);
  return values.map((value) => BigInt(value));
}

function oddHigherPowerList(lo: number, hi: number): bigint[] {
  if (hi < 8 || hi < lo) return [];
  const root = Math.floor(Math.cbrt(hi));
  const composite = sieve(Math.max(root, 2));
  const values: number[] = [];
  for (let p = 2; p <= root; p++) {
    if (composite[p]) continue;
    let value = p;
    const step = p * p;
    while (value <= Math.floor(hi / step)) {
      value *= step;
      if (value >= lo) values.push(value);
    }
  }
  values.sort((a, b) => a - b);
  return values.map((value) => BigInt(value));
}

function oddPowersOfTwoInRange(lo: bigint, hi: bigint, limit: number): number {
  if (hi < 8n || hi < lo) return 0;
  let value = 8n;
  if (lo > value) {
    const floorLog = lo.toString(2).length - 1;
    let exp = floorLog;
    if (1n << BigInt(exp) < lo) exp += 1;
    if (exp < 3) exp = 3;
    if (exp % 2 === 0) exp += 1;
    value = 1n << BigInt(exp);
  }
  let count = 0;
  while (value <= hi && count <= limit + 1) {
    count += 1;
    if (value > hi >> 2n) break;
    value <<= 2n;
  }
  return count;
}

function scanMatching(
  start: bigint,
  hi: bigint,
  stopAt: number,
  matches: (n: bigint) => boolean,
): { values: bigint[]; finished: boolean } {
  const values: bigint[] = [];
  let current = start;
  const budgetEnd = current + BigInt(PRIME_SEARCH_BUDGET);
  const end = hi - current > BigInt(PRIME_SEARCH_BUDGET) ? budgetEnd : hi;
  while (current <= end && values.length < stopAt) {
    if (matches(current)) values.push(current);
    current += 1n;
  }
  return { values, finished: current > hi };
}

/** p^k with k odd, including primes (k = 1). Even exponents and other composites are not. */
export function isOddPrimePower(n: bigint): boolean {
  if (n < 2n) return false;
  if ((n & (n - 1n)) === 0n) return ((n.toString(2).length - 1) & 1) === 1;
  if ((n & 1n) === 0n) return false;
  if (isPrime(n)) return true;
  return isOddHigherPrimePower(n);
}

function isOddHigherPrimePower(n: bigint): boolean {
  if (n < 8n) return false;
  const maxExp = n.toString(2).length - 1;
  for (let exp = 3; exp <= maxExp; exp += 2) {
    const root = integerRoot(n, exp);
    if (powEquals(root, exp, n) && isPrime(root)) return true;
  }
  return false;
}

function integerRoot(n: bigint, exp: number): bigint {
  let lo = 1n;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi + 1n) >> 1n;
    if (powExceeds(mid, exp, n)) hi = mid - 1n;
    else lo = mid;
  }
  return lo;
}

function powExceeds(base: bigint, exp: number, limit: bigint): boolean {
  let result = 1n;
  for (let i = 0; i < exp; i++) {
    if (base !== 0n && result > limit / base) return true;
    result *= base;
  }
  return false;
}

function powEquals(base: bigint, exp: number, target: bigint): boolean {
  let result = 1n;
  for (let i = 0; i < exp; i++) {
    if (base !== 0n && result > target / base) return false;
    result *= base;
  }
  return result === target;
}

/** At least this many primes in [lo, hi], or a smaller under-count. Never over-counts. */
function bertrandLowerBound(lo: bigint, hi: bigint, limit: number): number {
  let m = lo < 2n ? 2n : lo;
  let count = 0;
  while (count <= limit && 2n * m - 1n <= hi) {
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
  // Expansion only runs when the distinct total fits the active cap, so this
  // window is short enough to scan.
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

/** Overlap of two merged ascending interval lists. */
function intersectIntervals(left: Interval[], right: Interval[]): Interval[] {
  const result: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const start = left[i][0] > right[j][0] ? left[i][0] : right[j][0];
    const end = left[i][1] < right[j][1] ? left[i][1] : right[j][1];
    if (start <= end) result.push([start, end]);
    if (left[i][1] <= right[j][1]) i += 1;
    else j += 1;
  }
  return result;
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
 * when the distinct count is within the active cap.
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
    if (piece.kind === 'primes') {
      for (const prime of listPrimes(piece.lo, piece.hi)) {
        duplicates += remember(prime, seeds, seen);
      }
      continue;
    }
    if (piece.kind === 'powers') {
      for (const power of listPrimePowers(piece.lo, piece.hi)) {
        duplicates += remember(power, seeds, seen);
      }
      continue;
    }
    for (const power of listOddPrimePowers(piece.lo, piece.hi)) {
      duplicates += remember(power, seeds, seen);
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

function parseIndividuals(pieces: Piece[], rejected: string[], limit: number): ParsedSeeds {
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
    if (seeds.length >= limit) {
      omitted += 1;
      continue;
    }
    seeds.push(piece.value);
  }

  return {
    seeds,
    rejected,
    duplicates,
    omitted,
    overflow: null,
    reversed: 0,
    emptyPrimes: [],
    emptyPrimePowers: [],
    emptyOddPrimePowers: [],
    tooWide: [],
    tooWidePowers: [],
    tooWideOddPowers: [],
    overCap: false,
    primeOnly: false,
    primePowerOnly: false,
    oddPrimePowerOnly: false,
  };
}

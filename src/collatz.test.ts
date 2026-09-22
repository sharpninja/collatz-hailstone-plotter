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
    expect(parsed.overflow).toBeNull();
  });

  it('expands inclusive ranges in first-seen order', () => {
    expect(parseSeeds('1..5').seeds).toEqual([1n, 2n, 3n, 4n, 5n]);
    expect(parseSeeds('1...5').seeds).toEqual([1n, 2n, 3n, 4n, 5n]);
    expect(parseSeeds('20..27').seeds).toEqual([20n, 21n, 22n, 23n, 24n, 25n, 26n, 27n]);
    expect(parseSeeds('7..7').seeds).toEqual([7n]);
    expect(parseSeeds('3, 10..12, 27').seeds).toEqual([3n, 10n, 11n, 12n, 27n]);
    expect(parseSeeds('27 10..12').seeds).toEqual([27n, 10n, 11n, 12n]);
    expect(parseSeeds('1 .. 3').seeds).toEqual([1n, 2n, 3n]);
    expect(parseSeeds('1 ... 3').seeds).toEqual([1n, 2n, 3n]);
  });

  it('accepts a hyphen range and dedupes overlaps', () => {
    expect(parseSeeds('8-10').seeds).toEqual([8n, 9n, 10n]);
    expect(parseSeeds('10 - 12').seeds).toEqual([10n, 11n, 12n]);
    const parsed = parseSeeds('5, 3..6, 4, 1...3');
    expect(parsed.seeds).toEqual([5n, 3n, 4n, 6n, 1n, 2n]);
    expect(parsed.duplicates).toBe(3);
    expect(parsed.overflow).toBeNull();
    const overlap = parseSeeds('1..8, 5..12');
    expect(overlap.seeds).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n, 11n, 12n]);
    expect(overlap.duplicates).toBe(4);
  });

  it('reads a reversed range from the smaller end upward', () => {
    const parsed = parseSeeds('8..5, 4..4');
    expect(parsed.seeds).toEqual([5n, 6n, 7n, 8n, 4n]);
    expect(parsed.reversed).toBe(1);
    expect(parsed.overflow).toBeNull();
  });

  it('refuses an oversize range with the expanded count and does not walk it', () => {
    const modest = parseSeeds('1..13');
    expect(modest.seeds).toEqual([]);
    expect(modest.overflow).toBe(13n);
    expect(modest.omitted).toBe(0);

    expect(parseSeeds('1..100000').overflow).toBe(100000n);
    expect(parseSeeds('2..100000').overflow).toBe(99999n);
    expect(parseSeeds('3, 1..12, 27').seeds).toEqual([]);
    expect(parseSeeds('3, 1..12, 27').overflow).toBe(13n);
    expect(parseSeeds('1..8, 5..13').seeds).toEqual([]);
    expect(parseSeeds('1..8, 5..13').overflow).toBe(13n);

    const started = Date.now();
    const enormous = parseSeeds(`1..1${'0'.repeat(40)}`);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(enormous.seeds).toEqual([]);
    expect(enormous.overflow).toBe(10n ** 40n);

    const swapped = parseSeeds('50..1');
    expect(swapped.seeds).toEqual([]);
    expect(swapped.overflow).toBe(50n);
    expect(swapped.reversed).toBe(1);
  });

  it('rejects a range that includes a non-positive end', () => {
    const parsed = parseSeeds('0..5, 1..0, 1....5, foo, 4');
    expect(parsed.seeds).toEqual([4n]);
    expect(parsed.rejected).toEqual(['0..5', '1..0', '1....5', 'foo']);
    expect(parsed.overflow).toBeNull();
  });

  it('expands a prime range to the primes inside it', () => {
    expect(parseSeeds('primes:20..30').seeds).toEqual([23n, 29n]);
    expect(parseSeeds('primes:20..30').primeOnly).toBe(true);
    expect(parseSeeds('p:20..30').primeOnly).toBe(true);
    expect(parseSeeds('20..30').primeOnly).toBe(false);
    expect(parseSeeds('27').primeOnly).toBe(false);
    expect(parseSeeds('p:20..30').seeds).toEqual([23n, 29n]);
    expect(parseSeeds('primes 20..30').seeds).toEqual([23n, 29n]);
    expect(parseSeeds('Primes:20..30').seeds).toEqual([23n, 29n]);
    expect(parseSeeds('primes: 20 .. 30').seeds).toEqual([23n, 29n]);
    expect(parseSeeds('primes:20...30').seeds).toEqual([23n, 29n]);
    expect(parseSeeds('p:20-30').seeds).toEqual([23n, 29n]);
    expect(parseSeeds('primes:00020..00030').seeds).toEqual([23n, 29n]);
    expect(parseSeeds('primes:20..50').seeds).toEqual([23n, 29n, 31n, 37n, 41n, 43n, 47n]);
    expect(parseSeeds('primes:1..3').seeds).toEqual([2n, 3n]);
    expect(parseSeeds('primes:2..2').seeds).toEqual([2n]);
    expect(parseSeeds('primes:1..37').seeds).toEqual([
      2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n,
    ]);
    expect(parseSeeds('20..30').seeds).toEqual([20n, 21n, 22n, 23n, 24n, 25n, 26n, 27n, 28n, 29n, 30n]);
  });

  it('mixes prime ranges with literals and ordinary ranges', () => {
    expect(parseSeeds('27, primes:20..30').seeds).toEqual([27n, 23n, 29n]);
    expect(parseSeeds('27, primes:20..30').primeOnly).toBe(false);
    expect(parseSeeds('primes:10..20, primes:15..30').primeOnly).toBe(true);
    expect(parseSeeds('27, primes:20..40').seeds).toEqual([27n, 23n, 29n, 31n, 37n]);
    expect(parseSeeds('20..22, primes:20..30').seeds).toEqual([20n, 21n, 22n, 23n, 29n]);
    const overlap = parseSeeds('23, primes:20..30');
    expect(overlap.seeds).toEqual([23n, 29n]);
    expect(overlap.duplicates).toBe(1);
    const covered = parseSeeds('2, primes:2..37');
    expect(covered.seeds).toEqual([2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]);
    expect(covered.duplicates).toBe(1);
    expect(covered.overflow).toBeNull();
    const stacked = parseSeeds('primes:10..20, primes:15..30');
    expect(stacked.seeds).toEqual([11n, 13n, 17n, 19n, 23n, 29n]);
    expect(stacked.duplicates).toBe(2);
  });

  it('rejects an empty prime range', () => {
    const parsed = parseSeeds('primes:14..16');
    expect(parsed.seeds).toEqual([]);
    expect(parsed.emptyPrimes).toEqual(['14..16']);
    expect(parsed.primeOnly).toBe(false);
    expect(parsed.overflow).toBeNull();
    expect(parsed.overCap).toBe(false);

    expect(parseSeeds('p:14..16').emptyPrimes).toEqual(['14..16']);
    expect(parseSeeds('primes:1..1').emptyPrimes).toEqual(['1..1']);
    expect(parseSeeds('primes:8..10').emptyPrimes).toEqual(['8..10']);
    expect(parseSeeds('primes:4..4').emptyPrimes).toEqual(['4..4']);

    const mixed = parseSeeds('27, primes:14..16, foo');
    expect(mixed.seeds).toEqual([]);
    expect(mixed.emptyPrimes).toEqual(['14..16']);
    expect(mixed.rejected).toEqual(['foo']);

    const swapped = parseSeeds('primes:16..14');
    expect(swapped.seeds).toEqual([]);
    expect(swapped.emptyPrimes).toEqual(['14..16']);
    expect(swapped.reversed).toBe(1);
  });

  it('reads a reversed prime range from the smaller end upward', () => {
    const parsed = parseSeeds('primes:30..20');
    expect(parsed.seeds).toEqual([23n, 29n]);
    expect(parsed.reversed).toBe(1);
    expect(parsed.overflow).toBeNull();
    expect(parseSeeds('p:50..20').seeds).toEqual([23n, 29n, 31n, 37n, 41n, 43n, 47n]);
  });

  it('refuses an oversize prime range with the expanded count', () => {
    const hundred = parseSeeds('primes:1..100');
    expect(hundred.seeds).toEqual([]);
    expect(hundred.overflow).toBe(25n);
    expect(hundred.omitted).toBe(0);
    expect(hundred.overCap).toBe(false);

    expect(parseSeeds('primes:1..41').overflow).toBe(13n);
    expect(parseSeeds('primes:1..41').seeds).toEqual([]);
    expect(parseSeeds('1, primes:1..37').overflow).toBe(13n);
    expect(parseSeeds('primes:1..37, 1..2').overflow).toBe(13n);

    const started = Date.now();
    const many = parseSeeds('primes:1..100000');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(many.seeds).toEqual([]);
    expect(many.overflow).toBe(9592n);

    const swapped = parseSeeds('primes:100..1');
    expect(swapped.seeds).toEqual([]);
    expect(swapped.overflow).toBe(25n);
    expect(swapped.reversed).toBe(1);
  });

  it('refuses an enormous prime range without walking it', () => {
    const started = Date.now();
    const enormous = parseSeeds(`primes:1..1${'0'.repeat(40)}`);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(enormous.seeds).toEqual([]);
    expect(enormous.overflow).toBeNull();
    expect(enormous.overCap).toBe(true);
    expect(enormous.emptyPrimes).toEqual([]);
  });

  it('checks primes past the sieve limit one candidate at a time', () => {
    expect(parseSeeds('primes:10000019..10000019').seeds).toEqual([10000019n]);
    expect(parseSeeds('primes:10000019..10000021').seeds).toEqual([10000019n]);
    const empty = parseSeeds('primes:10000020..10000022');
    expect(empty.seeds).toEqual([]);
    expect(empty.emptyPrimes).toEqual(['10000020..10000022']);
    expect(parseSeeds('primes:1000000007..1000000009').seeds).toEqual([1000000007n, 1000000009n]);
  });

  it('rejects a prime range with a non-positive end', () => {
    const parsed = parseSeeds('primes:0..10, primes:1..0, primes:10....20, 4');
    expect(parsed.seeds).toEqual([4n]);
    expect(parsed.rejected).toEqual(['primes:0..10', 'primes:1..0', 'primes:10....20']);
    expect(parsed.emptyPrimes).toEqual([]);
    expect(parsed.overflow).toBeNull();
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

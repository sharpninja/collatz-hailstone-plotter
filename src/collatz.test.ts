import { describe, expect, it } from 'vitest';
import { EMERGENCY_ITERATION_CAP, firstCommonValue, hailstone, peakValue, type Trajectory } from './collatz';
import { MAX_SEEDS, MAX_SEEDS_LIMIT, isOddPrimePower, parseMaxIterations, parseMaxSeeds, parseSeeds } from './parse';

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

  it('reaches 1 for 27 under the emergency ceiling', () => {
    expect(EMERGENCY_ITERATION_CAP).toBe(10_000_000);
    const trajectory = hailstone(27n, EMERGENCY_ITERATION_CAP);
    expect(trajectory.reachedOne).toBe(true);
    expect(trajectory.stoppedForSize).toBe(false);
    expect(trajectory.values).toHaveLength(112);
  });

  it('stops before a term overflows the chart', () => {
    const seed = 10n ** 308n - 1n;
    const huge = hailstone(seed, 5);
    expect(huge.stoppedForSize).toBe(true);
    expect(huge.reachedOne).toBe(false);
    expect(huge.values).toEqual([seed]);
  });
});

function path(seed: bigint, values: bigint[]): Trajectory {
  return { seed, values, reachedOne: values.at(-1) === 1n, stoppedForSize: false };
}

describe('firstCommonValue', () => {
  it('names 47 as the first value shared by 27, 31, 41, and 47', () => {
    const series = [27n, 31n, 41n, 47n].map((seed) => hailstone(seed, 10_000));
    const found = firstCommonValue(series);
    expect(found).not.toBeNull();
    expect(found?.onlyAtOne).toBe(false);
    expect(found?.none).toBe(false);
    expect(found?.value).toBe(47n);
    expect(found?.hits).toEqual([
      { seed: 27n, index: 7 },
      { seed: 31n, index: 2 },
      { seed: 41n, index: 5 },
      { seed: 47n, index: 0 },
    ]);
  });

  it('skips a single seed and reports a meeting that is only 1', () => {
    expect(firstCommonValue([hailstone(27n, 100)])).toBeNull();
    const onlyOne = firstCommonValue([hailstone(1n, 10), hailstone(2n, 10)]);
    expect(onlyOne?.value).toBeNull();
    expect(onlyOne?.onlyAtOne).toBe(true);
    expect(onlyOne?.none).toBe(false);
  });

  it('reports no shared term when a cap stops the runs before they meet', () => {
    const found = firstCommonValue([hailstone(27n, 4), hailstone(31n, 1)]);
    expect(found?.none).toBe(true);
    expect(found?.value).toBeNull();
    expect(found?.onlyAtOne).toBe(false);
  });

  it('breaks ties by the sum of indexes, then the smaller value', () => {
    const bySum = firstCommonValue([
      path(9n, [9n, 6n, 3n, 1n]),
      path(6n, [6n, 3n, 9n, 1n]),
    ]);
    expect(bySum?.value).toBe(6n);
    expect(bySum?.hits.map((hit) => hit.index)).toEqual([1, 0]);

    const byValue = firstCommonValue([
      path(4n, [4n, 8n, 1n]),
      path(8n, [8n, 4n, 1n]),
    ]);
    expect(byValue?.value).toBe(4n);
    expect(byValue?.hits.map((hit) => hit.index)).toEqual([0, 1]);
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

  it('expands past 12 seeds when the cap is raised', () => {
    const blocked = parseSeeds('1..31');
    expect(blocked.seeds).toEqual([]);
    expect(blocked.overflow).toBe(31n);

    const allowed = parseSeeds('1..31', 31);
    expect(allowed.overflow).toBeNull();
    expect(allowed.seeds).toHaveLength(31);
    expect(allowed.seeds[0]).toBe(1n);
    expect(allowed.seeds[30]).toBe(31n);

    const stillOver = parseSeeds('1..40', 31);
    expect(stillOver.seeds).toEqual([]);
    expect(stillOver.overflow).toBe(40n);

    const oddBlocked = parseSeeds('oddprimepowers:2..107');
    expect(oddBlocked.seeds).toEqual([]);
    expect(oddBlocked.overflow).toBe(31n);
    expect(oddBlocked.oddPrimePowerOnly).toBe(false);

    const odd = parseSeeds('oddprimepowers:2..107', 31);
    expect(odd.overflow).toBeNull();
    expect(odd.overCap).toBe(false);
    expect(odd.seeds).toHaveLength(31);
    expect(odd.oddPrimePowerOnly).toBe(true);
    expect(odd.seeds[0]).toBe(2n);
    expect(odd.seeds).toContain(8n);
    expect(odd.seeds).toContain(27n);
    expect(odd.seeds).toContain(32n);
    expect(odd.seeds[odd.seeds.length - 1]).toBe(107n);
    expect(odd.seeds).not.toContain(9n);
    expect(odd.seeds).not.toContain(25n);

    const individuals = parseSeeds(Array.from({ length: 20 }, (_, i) => String(i + 1)).join(','), 20);
    expect(individuals.seeds).toHaveLength(20);
    expect(individuals.omitted).toBe(0);
    const trimmed = parseSeeds(Array.from({ length: 20 }, (_, i) => String(i + 1)).join(','), 15);
    expect(trimmed.seeds).toHaveLength(15);
    expect(trimmed.seeds[0]).toBe(1n);
    expect(trimmed.seeds[14]).toBe(15n);
    expect(trimmed.omitted).toBe(5);

    expect(parseSeeds('1..600', MAX_SEEDS_LIMIT + 50).overflow).toBe(600n);
    expect(parseSeeds('1..600', MAX_SEEDS_LIMIT + 50).seeds).toEqual([]);
    expect(parseSeeds('primes:1..200', 50).seeds).toHaveLength(46);
    expect(parseSeeds('primes:1..200').overflow).toBe(46n);
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

  it('expands prime powers, including 27 = 3^3', () => {
    expect(parseSeeds('primepowers:2..50').seeds).toEqual([4n, 8n, 9n, 16n, 25n, 27n, 32n, 49n]);
    expect(parseSeeds('primepowers:2..50').primePowerOnly).toBe(true);
    expect(parseSeeds('primepowers:2..50').primeOnly).toBe(false);
    expect(parseSeeds('pp:2..50').seeds).toEqual([4n, 8n, 9n, 16n, 25n, 27n, 32n, 49n]);
    expect(parseSeeds('primepowers 20..40').seeds).toEqual([25n, 27n, 32n]);
    expect(parseSeeds('PrimePowers:25..27').seeds).toEqual([25n, 27n]);
    expect(parseSeeds('primepowers:27..27').seeds).toEqual([27n]);
    expect(parseSeeds('pp:27..27').seeds).toEqual([27n]);
    expect(parseSeeds('primepowers:2..100').seeds).toEqual([4n, 8n, 9n, 16n, 25n, 27n, 32n, 49n, 64n, 81n]);
    expect(parseSeeds('primepowers:36..36').seeds).toEqual([]);
    expect(parseSeeds('primepowers:36..36').emptyPrimePowers).toEqual(['36..36']);
    expect(parseSeeds('20..30').seeds).toEqual([20n, 21n, 22n, 23n, 24n, 25n, 26n, 27n, 28n, 29n, 30n]);
    expect(parseSeeds('primes:20..30').seeds).toEqual([23n, 29n]);
  });

  it('mixes prime powers with primes and literals', () => {
    const mixed = parseSeeds('27, primes:20..40, primepowers:2..30');
    expect(mixed.seeds).toEqual([27n, 23n, 29n, 31n, 37n, 4n, 8n, 9n, 16n, 25n]);
    expect(mixed.duplicates).toBe(1);
    expect(mixed.primeOnly).toBe(false);
    expect(mixed.primePowerOnly).toBe(false);
    const beside = parseSeeds('4..9, primepowers:2..30');
    expect(beside.seeds).toEqual([4n, 5n, 6n, 7n, 8n, 9n, 16n, 25n, 27n]);
    expect(beside.duplicates).toBe(3);
  });

  it('rejects an empty prime-power range and swaps inverted bounds', () => {
    const empty = parseSeeds('primepowers:10..15');
    expect(empty.seeds).toEqual([]);
    expect(empty.emptyPrimePowers).toEqual(['10..15']);
    expect(empty.primePowerOnly).toBe(false);
    const swapped = parseSeeds('primepowers:30..4');
    expect(swapped.seeds).toEqual([4n, 8n, 9n, 16n, 25n, 27n]);
    expect(swapped.reversed).toBe(1);
    const both = parseSeeds('primes:14..16, primepowers:10..15');
    expect(both.seeds).toEqual([]);
    expect(both.emptyPrimes).toEqual(['14..16']);
    expect(both.emptyPrimePowers).toEqual(['10..15']);
  });

  it('refuses an oversize prime-power range', () => {
    const wide = parseSeeds('primepowers:2..200');
    expect(wide.seeds).toEqual([]);
    expect(wide.overflow).toBe(14n);
    expect(wide.primePowerOnly).toBe(false);
    const started = Date.now();
    const enormous = parseSeeds(`primepowers:4..1${'0'.repeat(40)}`);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(enormous.seeds).toEqual([]);
    expect(enormous.overCap).toBe(true);
    expect(parseSeeds('primepowers:16777216..16777216').seeds).toEqual([16777216n]);
    expect(parseSeeds('primepowers:0..10, 4').rejected).toEqual(['primepowers:0..10']);
    expect(parseSeeds('primepowers:0..10, 4').seeds).toEqual([4n]);
  });

  it('keeps 27 and drops 9 for odd-exponent prime powers', () => {
    const span = parseSeeds('oddprimepowers:2..30');
    expect(span.seeds).toEqual([2n, 3n, 5n, 7n, 8n, 11n, 13n, 17n, 19n, 23n, 27n, 29n]);
    expect(span.seeds).toContain(3n);
    expect(span.seeds).toContain(27n);
    expect(span.seeds).not.toContain(9n);
    expect(span.seeds).not.toContain(4n);
    expect(span.seeds).not.toContain(25n);
    expect(span.oddPrimePowerOnly).toBe(true);
    expect(span.primeOnly).toBe(false);
    expect(span.primePowerOnly).toBe(false);
    expect(parseSeeds('ppodd:8..32').seeds).toEqual([8n, 11n, 13n, 17n, 19n, 23n, 27n, 29n, 31n, 32n]);
    expect(parseSeeds('oddprimepowers:20..40').seeds).toEqual([23n, 27n, 29n, 31n, 32n, 37n]);
    expect(parseSeeds('oddprimepowers:25..27').seeds).toEqual([27n]);
    expect(parseSeeds('OddPrimePowers:3..27').seeds).toContain(3n);
    expect(parseSeeds('OddPrimePowers:3..27').seeds).toContain(27n);
    expect(parseSeeds('OddPrimePowers:3..27').seeds).not.toContain(9n);
    expect(parseSeeds('ppodd: 8 .. 32').seeds).toEqual(parseSeeds('oddprimepowers:8...32').seeds);
    expect(parseSeeds('primes:20..30').seeds).toEqual([23n, 29n]);
    expect(parseSeeds('primepowers:2..50').seeds).toContain(9n);
    expect(parseSeeds('primepowers:2..50').seeds).toContain(27n);
  });

  it('rejects an empty odd-exponent range and swaps inverted bounds', () => {
    const empty = parseSeeds('oddprimepowers:14..16');
    expect(empty.seeds).toEqual([]);
    expect(empty.emptyOddPrimePowers).toEqual(['14..16']);
    expect(empty.oddPrimePowerOnly).toBe(false);
    expect(parseSeeds('oddprimepowers:9..9').emptyOddPrimePowers).toEqual(['9..9']);
    expect(parseSeeds('ppodd:4..4').emptyOddPrimePowers).toEqual(['4..4']);
    expect(parseSeeds('oddprimepowers:24..26').seeds).toEqual([]);
    const swapped = parseSeeds('oddprimepowers:32-8');
    expect(swapped.seeds).toEqual([8n, 11n, 13n, 17n, 19n, 23n, 27n, 29n, 31n, 32n]);
    expect(swapped.reversed).toBe(1);
    const both = parseSeeds('primes:14..16, oddprimepowers:9..9');
    expect(both.seeds).toEqual([]);
    expect(both.emptyPrimes).toEqual(['14..16']);
    expect(both.emptyOddPrimePowers).toEqual(['9..9']);
  });

  it('mixes odd-exponent ranges without double-counting the cap', () => {
    const withPrimes = parseSeeds('primes:2..30, oddprimepowers:2..30');
    expect(withPrimes.seeds).toEqual([2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 8n, 27n]);
    expect(withPrimes.duplicates).toBe(10);
    expect(withPrimes.overflow).toBeNull();
    expect(withPrimes.primeOnly).toBe(false);
    expect(withPrimes.oddPrimePowerOnly).toBe(false);
    const withPowers = parseSeeds('primepowers:4..16, oddprimepowers:2..19');
    expect(withPowers.seeds).toEqual([4n, 8n, 9n, 16n, 2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n]);
    expect(withPowers.duplicates).toBe(1);
    expect(withPowers.overflow).toBeNull();
    const beside = parseSeeds('3, oddprimepowers:25..32');
    expect(beside.seeds).toEqual([3n, 27n, 29n, 31n, 32n]);
    expect(beside.seeds).not.toContain(9n);
    expect(beside.seeds).not.toContain(25n);
  });

  it('refuses an oversize odd-exponent range', () => {
    const wide = parseSeeds('oddprimepowers:2..50');
    expect(wide.seeds).toEqual([]);
    expect(wide.overflow).toBe(18n);
    expect(wide.oddPrimePowerOnly).toBe(false);
    const started = Date.now();
    const enormous = parseSeeds(`oddprimepowers:2..1${'0'.repeat(40)}`);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(enormous.seeds).toEqual([]);
    expect(enormous.overCap).toBe(true);
    expect(parseSeeds('oddprimepowers:33554432..33554432').seeds).toEqual([33554432n]);
    expect(parseSeeds('oddprimepowers:16777216..16777216').emptyOddPrimePowers).toEqual(['16777216..16777216']);
    expect(parseSeeds('oddprimepowers:14348907..14348907').seeds).toEqual([14348907n]);
    expect(parseSeeds('oddprimepowers:0..10, 3').rejected).toEqual(['oddprimepowers:0..10']);
    expect(parseSeeds('oddprimepowers:0..10, 3').seeds).toEqual([3n]);
  });
});

describe('isOddPrimePower', () => {
  it('keeps odd exponents, including primes, and drops even exponents', () => {
    expect(isOddPrimePower(27n)).toBe(true);
    expect(isOddPrimePower(3n)).toBe(true);
    expect(isOddPrimePower(8n)).toBe(true);
    expect(isOddPrimePower(32n)).toBe(true);
    expect(isOddPrimePower(2n)).toBe(true);
    expect(isOddPrimePower(125n)).toBe(true);
    expect(isOddPrimePower(9n)).toBe(false);
    expect(isOddPrimePower(25n)).toBe(false);
    expect(isOddPrimePower(4n)).toBe(false);
    expect(isOddPrimePower(16n)).toBe(false);
    expect(isOddPrimePower(36n)).toBe(false);
    expect(isOddPrimePower(1n)).toBe(false);
    expect(isOddPrimePower(6n)).toBe(false);
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

describe('parseMaxSeeds', () => {
  it('accepts a whole number from 1 through the control limit', () => {
    expect(parseMaxSeeds(String(MAX_SEEDS))).toBe(MAX_SEEDS);
    expect(parseMaxSeeds('31')).toBe(31);
    expect(parseMaxSeeds(String(MAX_SEEDS_LIMIT))).toBe(MAX_SEEDS_LIMIT);
    expect(parseMaxSeeds('0')).toBeNull();
    expect(parseMaxSeeds(String(MAX_SEEDS_LIMIT + 1))).toBeNull();
    expect(parseMaxSeeds('1.5')).toBeNull();
    expect(parseMaxSeeds('')).toBeNull();
  });
});

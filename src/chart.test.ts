import { describe, expect, it } from 'vitest';
import { buildLayout, hitTest, smoothThrough, type Cubic, type Vec } from './chart';
import { hailstone } from './collatz';

function at(start: Vec, curve: Cubic, t: number): Vec {
  const u = 1 - t;
  return {
    x: u ** 3 * start.x + 3 * u ** 2 * t * curve.c1x + 3 * u * t ** 2 * curve.c2x + t ** 3 * curve.x,
    y: u ** 3 * start.y + 3 * u ** 2 * t * curve.c1y + 3 * u * t ** 2 * curve.c2y + t ** 3 * curve.y,
  };
}

function samples(points: Vec[], steps = 8): Vec[] {
  const curves = smoothThrough(points);
  const found: Vec[] = [];
  curves.forEach((curve, index) => {
    for (let step = 0; step <= steps; step++) found.push(at(points[index], curve, step / steps));
  });
  return found;
}

describe('smoothThrough', () => {
  it('passes through every point and is not only a polyline', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 2, y: 10 },
      { x: 3, y: 4 },
      { x: 4, y: 1 },
    ];
    const curves = smoothThrough(points);
    expect(curves).toHaveLength(points.length - 1);
    curves.forEach((curve, index) => {
      expect(curve.x).toBeCloseTo(points[index + 1].x);
      expect(curve.y).toBeCloseTo(points[index + 1].y);
    });
    const intoPeak = curves[1];
    const previous = points[1];
    const peak = points[2];
    const t = (intoPeak.c2x - previous.x) / (peak.x - previous.x);
    const chordY = previous.y + t * (peak.y - previous.y);
    expect(Math.abs(intoPeak.c2y - chordY)).toBeGreaterThan(0.5);
  });

  it('keeps a straight run straight', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: 40 },
      { x: 30, y: 60 },
    ];
    for (const point of samples(points)) {
      expect(point.y).toBeCloseTo(point.x * 2, 5);
    }
  });

  it('rounds a steep crest instead of a straight corner', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 4 },
      { x: 2, y: 20 },
      { x: 3, y: 6 },
      { x: 4, y: 1 },
    ];
    const drawn = samples(points, 12);
    const crest = Math.max(...drawn.map((point) => point.y));
    expect(crest).toBeGreaterThanOrEqual(20);
    expect(crest).toBeLessThan(24);
    const intoPeak = smoothThrough(points)[1];
    const mid = at(points[1], intoPeak, 0.5);
    const chordY = (points[1].y + points[2].y) / 2;
    expect(Math.abs(mid.y - chordY)).toBeGreaterThan(1);
  });

  it('rounds a sharp peak instead of connecting it with a corner only', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 10 },
      { x: 2, y: 0 },
    ];
    const [incoming] = smoothThrough(points);
    const mid = at(points[0], incoming, 0.5);
    const chord = 5;
    expect(mid.y).not.toBeCloseTo(chord, 1);
    expect(mid.y).toBeLessThanOrEqual(10);
    expect(mid.y).toBeGreaterThan(chord);
  });
});

describe('buildLayout', () => {
  it('places the peak of 27 above the start and the end at the bottom of the descent', () => {
    const trajectory = hailstone(27n, 10_000);
    const layout = buildLayout([trajectory], { width: 960, height: 600, logY: false });
    const series = layout.series[0];
    const peak = series.samples.find((sample) => sample.exact === 9232n);
    const start = series.samples[0];
    const end = series.samples.at(-1);
    expect(peak).toBeDefined();
    expect(start.value).toBe(27);
    expect(end?.value).toBe(1);
    expect(peak!.y).toBeLessThan(start.y);
    expect(peak!.y).toBeLessThan(end!.y);
    expect(series.curves).toHaveLength(series.samples.length - 1);
    series.curves.forEach((curve, index) => {
      expect(curve.x).toBeCloseTo(series.samples[index + 1].x);
      expect(curve.y).toBeCloseTo(series.samples[index + 1].y);
    });
    const highest = Math.min(...series.samples.map((sample) => sample.y));
    expect(peak!.y).toBeCloseTo(highest, 5);
    const deviations = series.curves.map((curve, index) => {
      const start = series.samples[index];
      let worst = 0;
      for (const t of [0.25, 0.5, 0.75]) {
        const point = at(start, curve, t);
        const chordX = start.x + t * (curve.x - start.x);
        const chordY = start.y + t * (curve.y - start.y);
        worst = Math.max(worst, Math.hypot(point.x - chordX, point.y - chordY));
      }
      return worst;
    });
    deviations.sort((a, b) => a - b);
    const p90 = deviations[Math.floor(0.9 * (deviations.length - 1))];
    expect(p90).toBeGreaterThan(8);
  });

  it('keeps the same vertical order on a log axis', () => {
    const trajectory = hailstone(27n, 10_000);
    const layout = buildLayout([trajectory], { width: 960, height: 600, logY: true });
    const series = layout.series[0];
    const peak = series.samples.find((sample) => sample.peak)!;
    const start = series.samples[0];
    const end = series.samples.at(-1)!;
    expect(peak.y).toBeLessThan(start.y);
    expect(start.y).toBeLessThan(end.y);
    expect(layout.yLabel).toMatch(/log/i);
  });

  it('overlays several seeds in input order', () => {
    const series = [27n, 12n, 19n].map((seed) => hailstone(seed, 1000));
    const layout = buildLayout(series, { width: 800, height: 480, logY: false });
    expect(layout.series.map((item) => item.seed)).toEqual([27n, 12n, 19n]);
    expect(new Set(layout.series.map((item) => item.color)).size).toBe(3);
  });

  it('reads the sample under the cursor, including the peak of 27', () => {
    const layout = buildLayout([hailstone(27n, 10_000)], { width: 960, height: 600, logY: false });
    const peak = layout.series[0].samples.find((sample) => sample.exact === 9232n);
    expect(peak).toBeDefined();
    const hit = hitTest(layout, peak!.x + 2, peak!.y - 3);
    expect(hit?.step).toBe(peak!.step);
    expect(hit?.entries[0]?.exact).toBe(9232n);
    expect(hit?.entries[0]?.peak).toBe(true);
    expect(hitTest(layout, 0, 0)).toBeNull();
  });

  it('plots a single point at 1 without a curve', () => {
    const layout = buildLayout([hailstone(1n, 10)], { width: 640, height: 400, logY: false });
    expect(layout.series[0].samples).toHaveLength(1);
    expect(layout.series[0].curves).toHaveLength(0);
    expect(layout.series[0].samples[0].y).toBeGreaterThan(layout.plot.y);
    expect(layout.series[0].samples[0].y).toBeLessThan(layout.plot.y + layout.plot.h);
  });
});

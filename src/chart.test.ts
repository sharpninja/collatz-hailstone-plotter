import { describe, expect, it } from 'vitest';
import { SERIES_COLORS, alignedStep, buildFitPolylines, buildLayout, dataToSvg, hitTest, nearestBeat, selectionBandRect, stepsInAxisRange, svgXToAxis, smoothThrough, type Cubic, type Vec } from './chart';
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
    expect(start.beat).toBe(true);
    expect(series.samples.find((sample) => sample.exact === 4n)?.beat).toBe(false);
    expect(series.samples.find((sample) => sample.exact === 2n)?.beat).toBe(true);
    expect(end?.beat).toBe(false);
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

  it('marks odd-exponent prime powers as beats and leaves squares unmarked', () => {
    const trajectory = hailstone(9n, 100);
    const layout = buildLayout([trajectory], { width: 960, height: 600, logY: false });
    const series = layout.series[0];
    expect(series.samples[0].exact).toBe(9n);
    expect(series.samples[0].beat).toBe(false);
    expect(series.samples.find((sample) => sample.exact === 8n)?.beat).toBe(true);
    expect(series.samples.find((sample) => sample.exact === 16n)?.beat).toBe(false);
    expect(series.samples.find((sample) => sample.exact === 7n)?.beat).toBe(true);
    expect(series.samples.at(-1)?.exact).toBe(1n);
    expect(series.samples.at(-1)?.beat).toBe(false);
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

  it('cycles series colors once there are more seeds than palette entries', () => {
    const series = Array.from({ length: SERIES_COLORS.length + 1 }, (_, index) => hailstone(BigInt(index + 1), 30));
    const layout = buildLayout(series, { width: 800, height: 480, logY: false });
    expect(layout.series).toHaveLength(SERIES_COLORS.length + 1);
    expect(layout.series[0].color).toBe(SERIES_COLORS[0]);
    expect(layout.series[SERIES_COLORS.length].color).toBe(SERIES_COLORS[0]);
    expect(layout.series[1].color).toBe(SERIES_COLORS[1]);
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

  it('maps data coordinates onto the samples', () => {
    for (const logY of [false, true]) {
      const layout = buildLayout([hailstone(27n, 10_000)], { width: 960, height: 600, logY });
      for (const sample of layout.series[0].samples) {
        const point = dataToSvg(layout, sample.step, sample.value);
        expect(point.x).toBeCloseTo(sample.x);
        expect(point.y).toBeCloseTo(sample.y);
      }
    }
  });

  it('samples a fitted curve across the plotted domain', () => {
    const layout = buildLayout([hailstone(27n, 10_000)], { width: 960, height: 600, logY: false });
    const [line] = buildFitPolylines(layout, [
      { color: '#f4efe6', predict: () => 100, start: 0, end: layout.series[0].steps },
    ]);
    const drawn = line.points.filter((point): point is { x: number; y: number } => point !== null);
    expect(drawn.length).toBeGreaterThan(20);
    expect(drawn[0].x).toBeCloseTo(dataToSvg(layout, 0, 100).x);
    expect(drawn[0].y).toBeCloseTo(dataToSvg(layout, 0, 100).y);
    const last = drawn.at(-1)!;
    expect(last.x).toBeCloseTo(dataToSvg(layout, layout.series[0].steps, 100).x);
  });

  it('shares one iteration scale and one value scale across seeds', () => {
    const short = hailstone(8n, 100);
    const tall = hailstone(27n, 10_000);
    const layout = buildLayout([short, tall], { width: 800, height: 480, logY: false });
    expect(layout.align).toBe(false);
    const endShort = layout.series[0].samples.at(-1)!;
    const endTall = layout.series[1].samples.at(-1)!;
    expect(endShort.exact).toBe(1n);
    expect(endTall.exact).toBe(1n);
    expect(endShort.y).toBeCloseTo(endTall.y, 5);
    expect(layout.series[0].samples[0].x).toBeCloseTo(layout.series[1].samples[0].x, 5);
    expect(layout.series[0].samples[3].x).toBeCloseTo(layout.series[1].samples[3].x, 5);
    const peakShort = layout.series[0].samples.find((sample) => sample.peak)!;
    const peakTall = layout.series[1].samples.find((sample) => sample.peak)!;
    expect(peakTall.exact).toBeGreaterThan(peakShort.exact);
    expect(peakTall.y).toBeLessThan(peakShort.y);
    expect(layout.xLabel).toBe('Iterations to 1');
    expect(layout.yLabel).toBe('Value');
  });

  it('right-aligns paths so they all end at 1', () => {
    expect(alignedStep(0, 104, 111)).toBe(7);
    expect(alignedStep(104, 104, 111)).toBe(111);
    expect(alignedStep(111, 111, 111)).toBe(111);

    const longer = hailstone(27n, 10_000);
    const shorter = hailstone(47n, 10_000);
    expect(longer.values.length - 1).toBe(111);
    expect(shorter.values.length - 1).toBe(104);
    const layout = buildLayout([longer, shorter], { width: 800, height: 480, logY: false, align: true });
    const path27 = layout.series[0];
    const path47 = layout.series[1];
    const end27 = path27.samples.at(-1)!;
    const end47 = path47.samples.at(-1)!;
    expect(end27.exact).toBe(1n);
    expect(end47.exact).toBe(1n);
    expect(end27.x).toBeCloseTo(end47.x, 5);
    expect(path47.samples[0].x).toBeCloseTo(path27.samples[7].x, 5);
    expect(path27.samples[0].x).toBeLessThan(path47.samples[0].x);
    expect(layout.xLabel).toBe('Iterations to 1');
    expect(layout.yLabel).toBe('Value');
    const peak27 = path27.samples.find((sample) => sample.peak)!;
    expect(peak27.y).toBeLessThan(path47.samples[0].y);
    for (const series of layout.series) {
      for (const sample of series.samples) {
        const point = dataToSvg(layout, sample.step, sample.value, { steps: series.steps });
        expect(point.x).toBeCloseTo(sample.x);
        expect(point.y).toBeCloseTo(sample.y);
      }
    }
    const hit = hitTest(layout, end27.x, end27.y);
    expect(hit?.align).toBe(true);
    expect(hit?.entries.map((entry) => entry.exact)).toEqual([1n, 1n]);
    const start47 = hitTest(layout, path47.samples[0].x, path47.samples[0].y);
    expect(start47?.entries.map((entry) => entry.seed)).toEqual([27n, 47n]);
    expect(start47?.entries.map((entry) => entry.step)).toEqual([7, 0]);
  });

  it('maps a playback range to hailstone steps with align on and off', () => {
    expect(stepsInAxisRange(111, 111, false, { start: 40, end: 90 })).toEqual({ from: 40, to: 90 });
    expect(stepsInAxisRange(111, 111, false, { start: 90, end: 40 })).toEqual({ from: 40, to: 90 });
    expect(stepsInAxisRange(111, 111, false, { start: 200, end: 210 })).toBeNull();
    expect(stepsInAxisRange(20, 111, false, { start: 40, end: 90 })).toBeNull();

    expect(stepsInAxisRange(104, 111, true, { start: 7, end: 7 })).toEqual({ from: 0, to: 0 });
    expect(stepsInAxisRange(104, 111, true, { start: 40, end: 90 })).toEqual({ from: 33, to: 83 });
    expect(stepsInAxisRange(104, 111, true, { start: 0, end: 6 })).toBeNull();
    expect(stepsInAxisRange(111, 111, true, { start: 40, end: 90 })).toEqual({ from: 40, to: 90 });

    const longer = hailstone(27n, 10_000);
    const shorter = hailstone(47n, 10_000);
    const layout = buildLayout([longer, shorter], { width: 800, height: 480, logY: false, align: true });
    expect(svgXToAxis(layout, layout.series[1].samples[0].x)).toBe(7);
    expect(svgXToAxis(layout, layout.series[0].samples[40].x)).toBe(40);
    const off = buildLayout([longer], { width: 800, height: 480, logY: false, align: false });
    expect(svgXToAxis(off, off.series[0].samples[90].x)).toBe(90);
    const band = selectionBandRect(off, { start: 40, end: 90 });
    const gap = off.plot.w / off.xMax;
    const x40 = off.plot.x + (40 / off.xMax) * off.plot.w;
    const x90 = off.plot.x + (90 / off.xMax) * off.plot.w;
    expect(band.x).toBeCloseTo(x40 - gap / 2);
    expect(band.x + band.width).toBeCloseTo(x90 + gap / 2);
    expect(band.y).toBe(off.plot.y);
    expect(band.height).toBe(off.plot.h);
  });

  it('picks the nearest beat value in plot pixels, on either scale', () => {
    const linear = buildLayout([hailstone(27n, 10_000)], { width: 800, height: 480, logY: false });
    const start = linear.series[0].samples[0];
    expect(start.exact).toBe(27n);
    expect(start.beat).toBe(true);
    expect(nearestBeat(linear, start.x, start.y, 12)?.exact).toBe(27n);
    expect(nearestBeat(linear, start.x + 40, start.y + 40, 8)).toBeNull();
    const plain = linear.series[0].samples.find((sample) => !sample.beat);
    expect(plain).toBeDefined();
    expect(nearestBeat(linear, plain!.x, plain!.y, 0.4)).toBeNull();

    const logged = buildLayout([hailstone(27n, 10_000)], { width: 800, height: 480, logY: true });
    const logStart = logged.series[0].samples[0];
    expect(logStart.y).not.toBeCloseTo(start.y);
    expect(nearestBeat(logged, logStart.x, logStart.y, 12)?.exact).toBe(27n);

    const aligned = buildLayout([hailstone(27n, 10_000), hailstone(47n, 10_000)], {
      width: 800,
      height: 480,
      logY: false,
      align: true,
    });
    const at47 = aligned.series[1].samples[0];
    const beside = aligned.series[0].samples[7];
    expect(at47.exact).toBe(47n);
    expect(at47.beat).toBe(true);
    expect(at47.x).toBeCloseTo(beside.x);
    expect(nearestBeat(aligned, at47.x, at47.y, 24)?.exact).toBe(47n);
    const betweenY = (at47.y + beside.y) / 2;
    const toward47 = at47.y + (betweenY - at47.y) * 0.25;
    expect(nearestBeat(aligned, at47.x, toward47, 80)?.exact).toBe(at47.exact);
  });

  it('plots a single point at 1 without a curve', () => {
    const layout = buildLayout([hailstone(1n, 10)], { width: 640, height: 400, logY: false });
    expect(layout.series[0].samples).toHaveLength(1);
    expect(layout.series[0].curves).toHaveLength(0);
    expect(layout.series[0].samples[0].y).toBeGreaterThan(layout.plot.y);
    expect(layout.series[0].samples[0].y).toBeLessThan(layout.plot.y + layout.plot.h);
  });
});

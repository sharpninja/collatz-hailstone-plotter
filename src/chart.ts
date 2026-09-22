import { exceedsSafeInteger, peakValue, type Trajectory } from './collatz';
import { formatTick } from './format';

export const SERIES_COLORS = [
  '#e2b657',
  '#7ec8c3',
  '#e07a5f',
  '#c3b1f0',
  '#8fbf7f',
  '#f0a3c2',
  '#7eb6e8',
  '#e6d5a8',
  '#e08b6a',
  '#9ad4c8',
  '#d3d68a',
  '#e7a3a0',
];

export interface Vec {
  x: number;
  y: number;
}

export interface Cubic {
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
  x: number;
  y: number;
}

export interface LayoutSample {
  step: number;
  exact: bigint;
  value: number;
  x: number;
  y: number;
  peak: boolean;
  start: boolean;
  end: boolean;
}

export interface LayoutSeries {
  seed: bigint;
  color: string;
  reachedOne: boolean;
  stoppedForSize: boolean;
  approximate: boolean;
  peak: bigint;
  steps: number;
  samples: LayoutSample[];
  curves: Cubic[];
}

export interface AxisTick {
  value: number;
  x: number;
  y: number;
  label: string;
  major: boolean;
}

export interface Layout {
  width: number;
  height: number;
  logY: boolean;
  plot: { x: number; y: number; w: number; h: number };
  xMax: number;
  yMax: number;
  maxStep: number;
  xTicks: AxisTick[];
  yTicks: AxisTick[];
  series: LayoutSeries[];
  xLabel: string;
  yLabel: string;
  /** Horizontal center of the rotated value-axis title. */
  yTitleX: number;
}

export interface ChartPalette {
  grid: string;
  gridMinor: string;
  axis: string;
  tick: string;
  label: string;
  frame: string;
  /** Chart background, used to cut a halo under a dashed fit. */
  plot: string;
}

interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Uniform Catmull–Rom spline through every sample, as cubic Bézier segments.
 *
 * The usual handle length is one sixth of the neighboring chord. Hailstone
 * steps sit close together on the iteration axis and far apart in value, and
 * that shorter handle leaves the spikes looking like sharp corners. These
 * handles are twice as long, which rounds each turn. The curve still passes
 * through every term; positions between samples are only a reading guide.
 */
const CATMULL_HANDLE = 3;

export function smoothThrough(points: Vec[]): Cubic[] {
  const curves: Cubic[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    curves.push({
      c1x: p1.x + (p2.x - p0.x) / CATMULL_HANDLE,
      c1y: p1.y + (p2.y - p0.y) / CATMULL_HANDLE,
      c2x: p2.x - (p3.x - p1.x) / CATMULL_HANDLE,
      c2y: p2.y - (p3.y - p1.y) / CATMULL_HANDLE,
      x: p2.x,
      y: p2.y,
    });
  }
  return curves;
}

function niceStep(span: number): number {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const exp = Math.floor(Math.log10(span));
  const pow = 10 ** exp;
  const frac = span / pow;
  const nice = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  return nice * pow;
}

function linearDomain(dataMax: number, targetTicks: number): { max: number; step: number } {
  const top = Math.max(dataMax, 1);
  const step = Math.max(1, niceStep(top / Math.max(1, targetTicks - 1)));
  let max = Math.ceil((top * 1.06) / step) * step;
  if (max <= top) max += step;
  return { max, step };
}

function integerDomain(maxStep: number, targetTicks: number): { max: number; step: number } {
  if (maxStep <= 0) return { max: 1, step: 1 };
  const step = Math.max(1, Math.round(niceStep(maxStep / Math.max(1, targetTicks))));
  const max = Math.max(step, Math.ceil(maxStep / step) * step);
  return { max, step };
}

interface LogTick {
  value: number;
  major: boolean;
}

function logDomain(dataMax: number): { max: number; ticks: LogTick[] } {
  const max = Math.max(dataMax * 1.15, dataMax + 1, 8);
  const maxExp = Math.ceil(Math.log10(max));
  const ticks: LogTick[] = [];
  for (let exp = 0; exp <= maxExp; exp++) {
    for (const mantissa of [1, 2, 5]) {
      const value = mantissa * 10 ** exp;
      if (value < 1 || value > max * 1.001) continue;
      ticks.push({ value, major: mantissa === 1 });
    }
  }
  if (ticks.length === 0) ticks.push({ value: 1, major: true });
  return { max, ticks };
}

function roundTick(value: number, step: number): number {
  if (step >= 1) return Math.round(value);
  const places = Math.min(8, Math.ceil(-Math.log10(step)) + 1);
  return Number(value.toFixed(places));
}

function rangeTicks(min: number, max: number, step: number): number[] {
  const start = Math.ceil((min - step * 1e-9) / step);
  const end = Math.floor((max + step * 1e-9) / step);
  const ticks: number[] = [];
  for (let i = start; i <= end; i++) ticks.push(roundTick(i * step, step));
  return ticks;
}

function labelSet(ticks: LogTick[], maxLabels: number): Set<number> {
  const majors = ticks.filter((tick) => tick.major);
  const pool = majors.length <= 3 ? ticks : majors;
  if (pool.length <= maxLabels) return new Set(pool.map((tick) => tick.value));
  const stride = Math.ceil(pool.length / maxLabels);
  const chosen = new Set<number>();
  for (let i = 0; i < pool.length; i += stride) chosen.add(pool[i].value);
  chosen.add(pool[pool.length - 1].value);
  return chosen;
}

export function buildLayout(
  trajectories: Trajectory[],
  options: { width: number; height: number; logY: boolean },
): Layout {
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const logY = options.logY;
  const xTarget = width < 560 ? 5 : 8;
  const yTarget = height < 420 ? 4 : 6;

  let dataMax = 1;
  let maxStep = 0;
  for (const trajectory of trajectories) {
    maxStep = Math.max(maxStep, trajectory.values.length - 1);
    for (const value of trajectory.values) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) dataMax = Math.max(dataMax, numeric);
    }
  }

  const xDomain = integerDomain(maxStep, xTarget);
  const yLinear = linearDomain(dataMax, yTarget);
  const yLog = logDomain(dataMax);
  const yMax = logY ? yLog.max : yLinear.max;

  const yLabelSource = logY ? yLog.ticks.map((tick) => tick.value) : rangeTicks(0, yLinear.max, yLinear.step);
  const longest = yLabelSource.reduce((length, value) => Math.max(length, formatTick(value).length), 1);
  const yTitleX = width < 560 ? 14 : 18;
  const padding: Padding = {
    top: 20,
    right: width < 560 ? 16 : 28,
    bottom: 54,
    left: Math.round(yTitleX + 30 + longest * (width < 560 ? 6.6 : 7.3)),
  };

  const plot = {
    x: padding.left,
    y: padding.top,
    w: Math.max(1, width - padding.left - padding.right),
    h: Math.max(1, height - padding.top - padding.bottom),
  };

  const xOf = (step: number) => plot.x + (step / xDomain.max) * plot.w;
  const yOf = (value: number) => {
    const safe = Math.max(value, logY ? 1 : 0);
    const t = logY ? Math.log10(safe) / Math.log10(yMax) : safe / yMax;
    return plot.y + plot.h - t * plot.h;
  };

  const rawXTicks = rangeTicks(0, xDomain.max, xDomain.step).map((value) => ({
    value,
    x: xOf(value),
    y: plot.y + plot.h,
    label: formatTick(value),
    major: true,
  }));
  const xTicks = declutter(rawXTicks, (tick) => tick.x, 52);

  const labels = logY ? labelSet(yLog.ticks, 7) : null;
  const showMinor = logY && yLog.ticks.length <= 40;
  const ySource = logY
    ? yLog.ticks
        .filter((tick) => tick.major || showMinor)
        .map((tick) => ({
          value: tick.value,
          major: tick.major,
          label: labels?.has(tick.value) ? formatTick(tick.value) : '',
        }))
    : rangeTicks(0, yLinear.max, yLinear.step).map((value) => ({
        value,
        major: true,
        label: formatTick(value),
      }));
  const yTicks = declutter(
    ySource.map((tick) => ({
      value: tick.value,
      x: plot.x,
      y: yOf(tick.value),
      label: tick.label,
      major: tick.major,
    })),
    (tick) => tick.y,
    20,
  );

  const series: LayoutSeries[] = trajectories.map((trajectory, index) => {
    const peak = peakValue(trajectory.values);
    const samples: LayoutSample[] = trajectory.values.map((exact, step) => {
      const value = Number(exact);
      return {
        step,
        exact,
        value,
        x: xOf(step),
        y: yOf(value),
        peak: exact === peak,
        start: step === 0,
        end: step === trajectory.values.length - 1,
      };
    });
    return {
      seed: trajectory.seed,
      color: SERIES_COLORS[index % SERIES_COLORS.length],
      reachedOne: trajectory.reachedOne,
      stoppedForSize: trajectory.stoppedForSize,
      approximate: exceedsSafeInteger(trajectory.values),
      peak,
      steps: trajectory.values.length - 1,
      samples,
      curves: smoothThrough(samples.map((sample) => ({ x: sample.x, y: sample.y }))),
    };
  });

  return {
    width,
    height,
    logY,
    plot,
    xMax: xDomain.max,
    yMax,
    maxStep,
    xTicks,
    yTicks,
    series,
    xLabel: 'Iteration',
    yLabel: logY ? 'Value (log)' : 'Value',
    yTitleX,
  };
}

export function showSampleDot(sample: LayoutSample, count: number): boolean {
  return sample.peak || sample.start || sample.end || count <= 48;
}

function declutter<T extends { label: string }>(
  ticks: T[],
  position: (tick: T) => number,
  minGap: number,
): T[] {
  let last = Number.NEGATIVE_INFINITY;
  return ticks.map((tick) => {
    if (!tick.label) return tick;
    const at = position(tick);
    if (Math.abs(at - last) < minGap) return { ...tick, label: '' };
    last = at;
    return tick;
  });
}

export interface HoverHit {
  step: number;
  x: number;
  entries: Array<{
    color: string;
    seed: bigint;
    exact: bigint;
    y: number;
    peak: boolean;
  }>;
}

/** Nearest integer step under the cursor, while it is inside the plot frame. */
export function hitTest(layout: Layout, x: number, y: number): HoverHit | null {
  const { plot, xMax, maxStep } = layout;
  if (x < plot.x || x > plot.x + plot.w || y < plot.y || y > plot.y + plot.h) return null;
  if (maxStep < 0 || layout.series.length === 0) return null;

  const approx = ((x - plot.x) / plot.w) * xMax;
  let step = Math.round(approx);
  if (step < 0) step = 0;
  if (step > maxStep) step = maxStep;

  const sampleX = plot.x + (step / xMax) * plot.w;
  const gap = plot.w / xMax;
  const threshold = Math.max(gap * 0.65, 16);
  if (Math.abs(sampleX - x) > threshold) return null;

  const entries: HoverHit['entries'] = [];
  for (const series of layout.series) {
    const sample = series.samples[step];
    if (!sample) continue;
    entries.push({
      color: series.color,
      seed: series.seed,
      exact: sample.exact,
      y: sample.y,
      peak: sample.peak,
    });
  }
  if (entries.length === 0) return null;
  return { step, x: sampleX, entries };
}

export function seriesPath(series: LayoutSeries): string {
  const first = series.samples[0];
  if (!first) return '';
  const commands = [`M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`];
  for (const curve of series.curves) {
    commands.push(
      `C ${curve.c1x.toFixed(2)} ${curve.c1y.toFixed(2)}, ${curve.c2x.toFixed(2)} ${curve.c2y.toFixed(2)}, ${curve.x.toFixed(2)} ${curve.y.toFixed(2)}`,
    );
  }
  return commands.join(' ');
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

export interface ChartView {
  svg: SVGSVGElement;
  hoverLayer: SVGGElement;
  layout: Layout;
}

export interface FitPolyline {
  color: string;
  /** Null entries break the stroke, so a non-positive log prediction does not jump. */
  points: Array<{ x: number; y: number } | null>;
}

/** Map an iteration and Collatz value into the same pixel space as the samples. */
export function dataToSvg(layout: Layout, step: number, value: number): { x: number; y: number } {
  const { plot, xMax, yMax, logY } = layout;
  const x = plot.x + (step / xMax) * plot.w;
  const safe = Math.max(value, logY ? 1 : 0);
  const t = logY ? Math.log10(safe) / Math.log10(yMax) : safe / yMax;
  return { x, y: plot.y + plot.h - t * plot.h };
}

/** Sample a fitted value function densely enough to read as a smooth dashed curve. */
export function buildFitPolylines(
  layout: Layout,
  fits: Array<{ color: string; predict: (iteration: number) => number; start: number; end: number }>,
): FitPolyline[] {
  return fits.map((fit) => {
    const span = Math.max(0, fit.end - fit.start);
    const count = span <= 240 ? Math.max(2, Math.ceil(span * 2)) : 480;
    const points: FitPolyline['points'] = [];
    for (let index = 0; index <= count; index++) {
      const iteration = fit.start + (span * index) / count;
      const value = fit.predict(iteration);
      if (!Number.isFinite(value) || (layout.logY && value <= 0)) {
        points.push(null);
        continue;
      }
      points.push(dataToSvg(layout, iteration, value));
    }
    return { color: fit.color, points };
  });
}

export function renderChart(
  host: HTMLElement,
  layout: Layout,
  summary: string,
  fits: FitPolyline[] = [],
): ChartView {
  host.replaceChildren();
  const label = fits.length > 0 ? `${summary} A dashed curve shows a least-squares fit.` : summary;
  const svg = svgEl('svg', {
    viewBox: `0 0 ${layout.width} ${layout.height}`,
    width: String(layout.width),
    height: String(layout.height),
    role: 'img',
    'aria-label': label,
  });
  svg.classList.add('chart');

  const desc = svgEl('desc', {});
  desc.textContent = label;
  svg.append(desc);

  const defs = svgEl('defs', {});
  const clip = svgEl('clipPath', { id: 'series-clip' });
  clip.append(
    svgEl('rect', {
      x: String(layout.plot.x),
      y: String(layout.plot.y),
      width: String(layout.plot.w),
      height: String(layout.plot.h),
    }),
  );
  defs.append(clip);
  svg.append(defs);

  const frame = svgEl('rect', {
    x: String(layout.plot.x),
    y: String(layout.plot.y),
    width: String(layout.plot.w),
    height: String(layout.plot.h),
    class: 'plot-frame-line',
  });
  svg.append(frame);

  const grid = svgEl('g', { class: 'grid' });
  for (const tick of layout.yTicks) {
    grid.append(
      svgEl('line', {
        x1: String(layout.plot.x),
        x2: String(layout.plot.x + layout.plot.w),
        y1: String(tick.y),
        y2: String(tick.y),
        class: tick.major ? 'grid-major' : 'grid-minor',
      }),
    );
  }
  for (const tick of layout.xTicks) {
    grid.append(
      svgEl('line', {
        x1: String(tick.x),
        x2: String(tick.x),
        y1: String(layout.plot.y),
        y2: String(layout.plot.y + layout.plot.h),
        class: 'grid-major',
      }),
    );
  }
  svg.append(grid);

  const axes = svgEl('g', { class: 'axes' });
  for (const tick of layout.yTicks) {
    if (!tick.label) continue;
    const label = svgEl('text', {
      x: String(layout.plot.x - 10),
      y: String(tick.y),
      class: 'tick-label',
      'text-anchor': 'end',
      'dominant-baseline': 'middle',
    });
    label.textContent = tick.label;
    axes.append(label);
  }
  for (const tick of layout.xTicks) {
    if (!tick.label) continue;
    const label = svgEl('text', {
      x: String(tick.x),
      y: String(layout.plot.y + layout.plot.h + 16),
      class: 'tick-label',
      'text-anchor': 'middle',
    });
    label.textContent = tick.label;
    axes.append(label);
  }

  const xTitle = svgEl('text', {
    x: String(layout.plot.x + layout.plot.w / 2),
    y: String(layout.height - 14),
    class: 'axis-title',
    'text-anchor': 'middle',
  });
  xTitle.textContent = layout.xLabel;

  const yCenter = layout.plot.y + layout.plot.h / 2;
  const yTitle = svgEl('text', {
    x: String(layout.yTitleX),
    y: String(yCenter),
    class: 'axis-title',
    'text-anchor': 'middle',
    'dominant-baseline': 'middle',
    transform: `rotate(-90 ${layout.yTitleX} ${yCenter})`,
  });
  yTitle.textContent = layout.yLabel;
  axes.append(xTitle, yTitle);
  svg.append(axes);

  const curveLayer = svgEl('g', { 'clip-path': 'url(#series-clip)' });
  for (let index = layout.series.length - 1; index >= 0; index--) {
    const series = layout.series[index];
    const path = seriesPath(series);
    if (!path) continue;
    const group = svgEl('g', { class: 'series' });
    if (series.curves.length > 0) {
      group.append(
        svgEl('path', {
          d: path,
          class: 'series-glow',
          stroke: series.color,
        }),
        svgEl('path', {
          d: path,
          class: 'series-line',
          stroke: series.color,
        }),
      );
    }
    curveLayer.append(group);
  }
  svg.append(curveLayer);
  if (fits.length > 0) svg.append(fitLayer(fits));

  const markers = svgEl('g', { class: 'markers' });
  for (const series of layout.series) {
    for (const sample of series.samples) {
      if (!showSampleDot(sample, series.samples.length)) continue;
      const radius = sample.peak ? '4.2' : sample.start || sample.end ? '3.2' : '2.15';
      markers.append(
        svgEl('circle', {
          cx: String(sample.x),
          cy: String(sample.y),
          r: radius,
          fill: series.color,
          class: sample.peak ? 'peak-dot' : 'sample-dot',
        }),
      );
    }
  }
  svg.append(markers);

  const hoverLayer = svgEl('g', { class: 'hover-layer' });
  svg.append(hoverLayer);
  host.append(svg);
  return { svg, hoverLayer, layout };
}

export function renderHover(layer: SVGGElement, layout: Layout, hit: HoverHit | null): void {
  layer.replaceChildren();
  if (!hit) return;
  layer.append(
    svgEl('line', {
      x1: String(hit.x),
      x2: String(hit.x),
      y1: String(layout.plot.y),
      y2: String(layout.plot.y + layout.plot.h),
      class: 'hover-guide',
    }),
  );
  for (const entry of hit.entries) {
    layer.append(
      svgEl('circle', {
        cx: String(hit.x),
        cy: String(entry.y),
        r: '5.5',
        fill: entry.color,
        class: 'hover-dot',
      }),
    );
  }
}

export function paintChart(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  palette: ChartPalette,
  fits: FitPolyline[] = [],
): void {
  const { plot } = layout;
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y, plot.w, plot.h);
  ctx.strokeStyle = palette.frame;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.lineWidth = 1;
  strokeGrid(
    ctx,
    layout.yTicks.filter((tick) => tick.major),
    palette.grid,
    (tick) => [plot.x, tick.y, plot.x + plot.w, tick.y],
  );
  strokeGrid(
    ctx,
    layout.yTicks.filter((tick) => !tick.major),
    palette.gridMinor,
    (tick) => [plot.x, tick.y, plot.x + plot.w, tick.y],
  );
  strokeGrid(
    ctx,
    layout.xTicks,
    palette.grid,
    (tick) => [tick.x, plot.y, tick.x, plot.y + plot.h],
  );

  ctx.font = '12px ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';
  ctx.fillStyle = palette.tick;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const tick of layout.yTicks) {
    if (tick.label) ctx.fillText(tick.label, plot.x - 10, tick.y);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const tick of layout.xTicks) {
    if (tick.label) ctx.fillText(tick.label, tick.x, plot.y + plot.h + 8);
  }

  ctx.fillStyle = palette.label;
  ctx.font = '13px "Segoe UI", "DejaVu Sans", Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(layout.xLabel, plot.x + plot.w / 2, layout.height - 12);

  ctx.save();
  ctx.translate(layout.yTitleX, plot.y + plot.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = 'middle';
  ctx.fillText(layout.yLabel, 0, 0);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y, plot.w, plot.h);
  ctx.clip();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (let index = layout.series.length - 1; index >= 0; index--) {
    const series = layout.series[index];
    const first = series.samples[0];
    if (!first || series.curves.length === 0) continue;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (const curve of series.curves) {
      ctx.bezierCurveTo(curve.c1x, curve.c1y, curve.c2x, curve.c2y, curve.x, curve.y);
    }
    ctx.strokeStyle = hexToRgba(series.color, 0.22);
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = series.color;
    ctx.lineWidth = 2.25;
    ctx.stroke();
  }
  paintFits(ctx, fits, palette.plot);
  ctx.restore();

  for (const series of layout.series) {
    for (const sample of series.samples) {
      if (!showSampleDot(sample, series.samples.length)) continue;
      ctx.beginPath();
      ctx.fillStyle = series.color;
      ctx.arc(sample.x, sample.y, sample.peak ? 4.2 : sample.start || sample.end ? 3.2 : 2.15, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function fitLayer(fits: FitPolyline[]): SVGGElement {
  const layer = svgEl('g', { class: 'fit-layer', 'clip-path': 'url(#series-clip)' });
  for (const fit of fits) {
    const path = polylinePath(fit.points);
    if (!path) continue;
    layer.append(
      svgEl('path', { d: path, class: 'fit-halo' }),
      svgEl('path', { d: path, class: 'fit-line', stroke: fit.color }),
    );
  }
  return layer;
}

function polylinePath(points: Array<{ x: number; y: number } | null>): string {
  let path = '';
  let open = false;
  for (const point of points) {
    if (!point) {
      open = false;
      continue;
    }
    path += `${open ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)} `;
    open = true;
  }
  return path.trim();
}

function paintFits(ctx: CanvasRenderingContext2D, fits: FitPolyline[], halo: string): void {
  if (fits.length === 0) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const fit of fits) {
    tracePolyline(ctx, fit.points);
    ctx.setLineDash([]);
    ctx.strokeStyle = halo;
    ctx.lineWidth = 5;
    ctx.stroke();
    tracePolyline(ctx, fit.points);
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = fit.color;
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }
  ctx.restore();
}

function tracePolyline(ctx: CanvasRenderingContext2D, points: Array<{ x: number; y: number } | null>): void {
  ctx.beginPath();
  let open = false;
  for (const point of points) {
    if (!point) {
      open = false;
      continue;
    }
    if (!open) {
      ctx.moveTo(point.x, point.y);
      open = true;
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }
}

function strokeGrid(
  ctx: CanvasRenderingContext2D,
  ticks: AxisTick[],
  color: string,
  segment: (tick: AxisTick) => [number, number, number, number],
): void {
  if (ticks.length === 0) return;
  ctx.beginPath();
  for (const tick of ticks) {
    const [x1, y1, x2, y2] = segment(tick);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.strokeStyle = color;
  ctx.stroke();
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

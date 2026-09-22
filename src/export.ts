import { peakValue, type Trajectory } from './collatz';
import { buildFitPolylines, buildLayout, paintChart, type ChartPalette, type FitPolyline } from './chart';
import { formatCount, formatExact } from './format';

const PAGE_W = 1440;
const PAGE_H = 920;

export function pngFilename(seeds: bigint[]): string {
  if (seeds.length === 0) return 'collatz-trajectories.png';
  const head = seeds.slice(0, 4).map((seed) => seed.toString());
  const extra = seeds.length > 4 ? `-plus${seeds.length - 4}` : '';
  const body = `${head.join('-')}${extra}`;
  if (body.length > 80) return 'collatz-trajectories.png';
  return `collatz-${body}.png`;
}

function cssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function palette(): ChartPalette {
  return {
    grid: 'rgba(244, 239, 230, 0.1)',
    gridMinor: 'rgba(244, 239, 230, 0.05)',
    axis: cssColor('--line-strong', 'rgba(244, 239, 230, 0.55)'),
    tick: cssColor('--muted', '#b3aa9c'),
    label: cssColor('--text', '#f4efe6'),
    frame: 'rgba(244, 239, 230, 0.28)',
    plot: cssColor('--bg-raised', '#171512'),
  };
}

function outcome(trajectory: Trajectory): string {
  const steps = formatCount(trajectory.values.length - 1);
  const peak = formatExact(peakValue(trajectory.values));
  if (trajectory.reachedOne) return `${steps} steps · peak ${peak}`;
  if (trajectory.stoppedForSize) return `stopped · peak ${peak}`;
  return `capped at ${steps} · peak ${peak}`;
}

export interface PngFit {
  color: string;
  predict: (iteration: number) => number;
  start: number;
  end: number;
  /** Kept for callers that already pass a peak. Align does not rescale height. */
  peak?: number;
}

export function renderPng(
  trajectories: Trajectory[],
  logY: boolean,
  fits: PngFit[] = [],
  align = false,
  markBeats = true,
): HTMLCanvasElement {
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W * scale;
  canvas.height = PAGE_H * scale;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create a canvas for the PNG export.');
  context.scale(scale, scale);

  const bg = cssColor('--bg', '#0e0d0b');
  const raised = cssColor('--bg-raised', '#171512');
  const text = cssColor('--text', '#f4efe6');
  const muted = cssColor('--muted', '#b3aa9c');
  const accent = cssColor('--accent', '#e2b657');

  context.fillStyle = bg;
  context.fillRect(0, 0, PAGE_W, PAGE_H);

  context.fillStyle = text;
  context.font = '28px Georgia, "Liberation Serif", "DejaVu Serif", serif';
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillText('Collatz hailstone trajectories', 40, 48);

  context.fillStyle = muted;
  context.font = '15px "Segoe UI", "DejaVu Sans", Helvetica, Arial, sans-serif';
  const axisNote = align
    ? 'paths shifted so they all end at 1'
    : logY
      ? 'logarithmic value axis'
      : 'linear value axis';
  const fitNote = fits.length > 0 ? ' Dashed curve: visual fit of the samples.' : '';
  const beatNote = markBeats ? ' Rings mark odd-exponent prime powers.' : '';
  context.fillText(
    `Stops at 1 · ${axisNote}. The curve passes through every term; bends between them are a guide.${fitNote}${beatNote}`,
    40,
    76,
  );

  const legendWidth = legendWidthFor(trajectories.length);
  const chartX = 24;
  const chartY = 104;
  const chartW = PAGE_W - chartX - 24 - (legendWidth ? legendWidth + 8 : 0);
  const chartH = PAGE_H - chartY - 28;

  context.fillStyle = raised;
  roundRect(context, chartX, chartY, chartW, chartH, 16);
  context.fill();

  const layout = buildLayout(trajectories, { width: chartW, height: chartH, logY, align });
  const overlays: FitPolyline[] = buildFitPolylines(layout, fits);
  context.save();
  context.translate(chartX, chartY);
  paintChart(context, layout, palette(), overlays, markBeats);
  context.restore();

  if (legendWidth) {
    drawSeedLegend(context, trajectories, layout.series.map((series) => series.color), {
      x: chartX + chartW + 20,
      y: chartY + 8,
      text,
      muted,
      accent,
    });
  } else if (trajectories[0]) {
    context.fillStyle = accent;
    context.font = '14px ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';
    context.textAlign = 'right';
    context.fillText(`${trimSeed(trajectories[0].seed)} · ${outcome(trajectories[0])}`, PAGE_W - 40, 76);
  }

  return canvas;
}

const COMPACT_ROW = 18;
const COMPACT_COLUMN = 150;
const LEGEND_HEADER = 26;

function legendWidthFor(count: number): number {
  if (count <= 1) return 0;
  if (count <= 12) return 280;
  return legendColumns(count) * COMPACT_COLUMN + 12;
}

/** Rows that fit under the chart title in a compact legend column. */
function compactRowsPerColumn(): number {
  const top = 104 + 8;
  const available = PAGE_H - 16 - top - LEGEND_HEADER;
  return Math.max(1, Math.floor(available / COMPACT_ROW));
}

function legendColumns(count: number): number {
  const perColumn = compactRowsPerColumn();
  return Math.min(4, Math.max(1, Math.ceil(count / perColumn)));
}

function drawSeedLegend(
  context: CanvasRenderingContext2D,
  trajectories: Trajectory[],
  colors: string[],
  box: { x: number; y: number; text: string; muted: string; accent: string },
): void {
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.font = '13px "Segoe UI", "DejaVu Sans", Helvetica, Arial, sans-serif';
  context.fillStyle = box.accent;
  context.fillText('Seeds', box.x, box.y + 12);
  const originY = box.y + LEGEND_HEADER;

  if (trajectories.length <= 12) {
    trajectories.forEach((trajectory, index) => {
      const y = originY + index * 54;
      paintSwatch(context, colors[index] ?? box.accent, box.x, y + 2, 18, 4);
      context.fillStyle = box.text;
      context.font = '14px ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';
      context.fillText(trimSeed(trajectory.seed), box.x, y + 22);
      context.fillStyle = box.muted;
      context.font = '12px "Segoe UI", "DejaVu Sans", Helvetica, Arial, sans-serif';
      context.fillText(outcome(trajectory), box.x, y + 40);
    });
    return;
  }

  const perColumn = compactRowsPerColumn();
  const columns = legendColumns(trajectories.length);
  const capacity = columns * perColumn;
  const truncated = trajectories.length > capacity;
  const shown = truncated ? capacity - 1 : trajectories.length;
  for (let index = 0; index < shown; index++) {
    const column = Math.floor(index / perColumn);
    const row = index % perColumn;
    const x = box.x + column * COMPACT_COLUMN;
    const y = originY + row * COMPACT_ROW;
    paintSwatch(context, colors[index] ?? box.accent, x, y + 4, 12, 3);
    context.fillStyle = box.text;
    context.font = '12px ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';
    context.fillText(trimSeed(trajectories[index].seed), x + 18, y + 12);
  }
  if (truncated) {
    const index = shown;
    const column = Math.floor(index / perColumn);
    const row = index % perColumn;
    const x = box.x + column * COMPACT_COLUMN;
    const y = originY + row * COMPACT_ROW;
    context.fillStyle = box.muted;
    context.font = '12px "Segoe UI", "DejaVu Sans", Helvetica, Arial, sans-serif';
    context.fillText(`+ ${formatCount(trajectories.length - shown)} more`, x, y + 12);
  }
}

function paintSwatch(
  context: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  context.fillStyle = color;
  roundRect(context, x, y, w, h, 2);
  context.fill();
}

function trimSeed(seed: bigint): string {
  const raw = seed.toString();
  if (raw.length <= 18) return formatExact(seed);
  return `${raw.slice(0, 8)}…${raw.slice(-4)}`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function downloadPng(
  trajectories: Trajectory[],
  logY: boolean,
  fits: PngFit[] = [],
  align = false,
  markBeats = true,
): void {
  const canvas = renderPng(trajectories, logY, fits, align, markBeats);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = pngFilename(trajectories.map((trajectory) => trajectory.seed));
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

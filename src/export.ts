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
}

export function renderPng(trajectories: Trajectory[], logY: boolean, fits: PngFit[] = []): HTMLCanvasElement {
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
  const axisNote = logY ? 'logarithmic value axis' : 'linear value axis';
  const fitNote = fits.length > 0 ? ' Dashed curve: least-squares fit of the samples.' : '';
  context.fillText(
    `Stops at 1 · ${axisNote}. The curve passes through every term; bends between them are a guide.${fitNote}`,
    40,
    76,
  );

  const legendWidth = trajectories.length > 1 ? 280 : 0;
  const chartX = 24;
  const chartY = 104;
  const chartW = PAGE_W - chartX - 24 - (legendWidth ? legendWidth + 8 : 0);
  const chartH = PAGE_H - chartY - 28;

  context.fillStyle = raised;
  roundRect(context, chartX, chartY, chartW, chartH, 16);
  context.fill();

  const layout = buildLayout(trajectories, { width: chartW, height: chartH, logY });
  const overlays: FitPolyline[] = buildFitPolylines(layout, fits);
  context.save();
  context.translate(chartX, chartY);
  paintChart(context, layout, palette(), overlays);
  context.restore();

  if (legendWidth) {
    const legendX = chartX + chartW + 20;
    let legendY = chartY + 8;
    context.font = '13px "Segoe UI", "DejaVu Sans", Helvetica, Arial, sans-serif';
    context.fillStyle = accent;
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillText('Seeds', legendX, legendY + 12);
    legendY += 26;
    trajectories.forEach((trajectory, index) => {
      const color = layout.series[index]?.color ?? accent;
      context.fillStyle = color;
      roundRect(context, legendX, legendY + 2, 18, 4, 2);
      context.fill();
      context.fillStyle = text;
      context.font = '14px ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';
      context.fillText(trimSeed(trajectory.seed), legendX, legendY + 22);
      context.fillStyle = muted;
      context.font = '12px "Segoe UI", "DejaVu Sans", Helvetica, Arial, sans-serif';
      context.fillText(outcome(trajectory), legendX, legendY + 40);
      legendY += 54;
    });
  } else if (trajectories[0]) {
    context.fillStyle = accent;
    context.font = '14px ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace';
    context.textAlign = 'right';
    context.fillText(`${trimSeed(trajectories[0].seed)} · ${outcome(trajectories[0])}`, PAGE_W - 40, 76);
  }

  return canvas;
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

export function downloadPng(trajectories: Trajectory[], logY: boolean, fits: PngFit[] = []): void {
  const canvas = renderPng(trajectories, logY, fits);
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

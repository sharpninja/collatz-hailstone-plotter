import { exceedsSafeInteger, hailstone, peakValue, type Trajectory } from './collatz';
import {
  SERIES_COLORS,
  buildFitPolylines,
  buildLayout,
  hitTest,
  renderChart,
  renderHover,
  type ChartView,
  type HoverHit,
} from './chart';
import { downloadPng, type PngFit } from './export';
import { fitSeries, type FitResult } from './fit';
import './style.css';
import { formatCount, formatExact } from './format';
import {
  MAX_ITERATION_CAP,
  MAX_SEEDS,
  TOTAL_STEP_BUDGET,
  parseMaxIterations,
  parseSeeds,
  type ParsedSeeds,
} from './parse';

const seedsInput = required<HTMLTextAreaElement>('seeds');
const maxInput = required<HTMLInputElement>('max-steps');
const logInput = required<HTMLInputElement>('log-scale');
const form = required<HTMLFormElement>('controls');
const message = required<HTMLDivElement>('form-message');
const legend = required<HTMLDivElement>('legend');
const plotHost = required<HTMLDivElement>('plot-host');
const emptyState = required<HTMLDivElement>('empty');
const tooltip = required<HTMLDivElement>('tooltip');
const downloadButton = required<HTMLButtonElement>('download');
const fitButton = required<HTMLButtonElement>('fit');
const clearButton = required<HTMLButtonElement>('clear');
const fitBlock = required<HTMLElement>('fit-block');
const fitResults = required<HTMLDivElement>('fit-results');
const plotNote = required<HTMLParagraphElement>('plot-note');

const PLOT_NOTE =
  'The curve passes through every term. Hover a step to read it. Only those terms are Collatz values — the bend between them is a guide.';
const PLOT_NOTE_FIT =
  'The curve passes through every term. The dashed line is a least-squares fit of those samples, not a closed form. Hover a step to read a term.';

interface FitOutcome {
  seed: bigint;
  color: string;
  end: number;
  approximate: boolean;
  result: FitResult;
}

let trajectories: Trajectory[] | null = null;
let lastParsed: ParsedSeeds | null = null;
let fits: FitOutcome[] | null = null;
let view: ChartView | null = null;
let renderFrame = 0;
let paintedKey = '';

form.addEventListener('submit', (event) => {
  event.preventDefault();
  generate();
});

logInput.addEventListener('change', () => {
  if (!trajectories) return;
  if (fits) fits = computeFits(trajectories, logInput.checked);
  showStatus();
  renderFitPanel();
  scheduleRender();
});

downloadButton.addEventListener('click', () => {
  if (!trajectories || trajectories.length === 0) return;
  downloadPng(trajectories, logInput.checked, pngFits(fits));
});

fitButton.addEventListener('click', () => {
  if (!trajectories || trajectories.length === 0) return;
  fits = computeFits(trajectories, logInput.checked);
  renderFitPanel();
  scheduleRender();
});

clearButton.addEventListener('click', () => {
  seedsInput.value = '';
  maxInput.value = '10000';
  logInput.checked = false;
  trajectories = null;
  lastParsed = null;
  view = null;
  paintedKey = '';
  hideTooltip();
  setMessage([]);
  renderLegend(null);
  resetFit();
  scheduleRender();
  downloadButton.disabled = true;
  fitButton.disabled = true;
  seedsInput.focus();
});

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-example]')) {
  button.addEventListener('click', () => {
    seedsInput.value = button.dataset.example ?? '';
    if (button.dataset.log === 'on') logInput.checked = true;
    if (button.dataset.log === 'off') logInput.checked = false;
    generate();
  });
}

plotHost.addEventListener('pointermove', (event) => {
  if (!view) return;
  const point = eventToSvg(view.svg, event);
  if (!point) {
    hideTooltip();
    return;
  }
  const hit = hitTest(view.layout, point.x, point.y);
  renderHover(view.hoverLayer, view.layout, hit);
  if (!hit) {
    hideTooltip();
    return;
  }
  showTooltip(hit, event.clientX, event.clientY);
});

plotHost.addEventListener('pointerleave', () => {
  hideTooltip();
  if (view) renderHover(view.hoverLayer, view.layout, null);
});

const observer = new ResizeObserver(() => scheduleRender());
observer.observe(plotHost);

generate();

function generate(): void {
  const parsed = parseSeeds(seedsInput.value);
  const maxIterations = parseMaxIterations(maxInput.value);
  if (parsed.seeds.length === 0) {
    trajectories = null;
    view = null;
    downloadButton.disabled = true;
    fitButton.disabled = true;
    resetFit();
    renderLegend(null);
    scheduleRender();
    const lead =
      parsed.rejected.length > 0
        ? 'None of those tokens are positive integers.'
        : 'Enter one or more positive integers.';
    setMessage([{ kind: 'error', text: lead }, ...warningParts(parsed, [])]);
    return;
  }
  if (maxIterations === null) {
    setMessage([
      {
        kind: 'error',
        text: `Set the iteration cap to a whole number from 1 to ${formatCount(MAX_ITERATION_CAP)}.`,
      },
    ]);
    return;
  }
  if (parsed.seeds.length * maxIterations > TOTAL_STEP_BUDGET) {
    setMessage([
      {
        kind: 'error',
        text: `That would allow more than ${formatCount(TOTAL_STEP_BUDGET)} steps in total. Use fewer seeds or a lower cap.`,
      },
    ]);
    return;
  }

  lastParsed = parsed;
  trajectories = parsed.seeds.map((seed) => hailstone(seed, maxIterations));
  downloadButton.disabled = false;
  fitButton.disabled = false;
  resetFit();
  showStatus();
  renderLegend(trajectories);
  scheduleRender();
}

function showStatus(): void {
  if (!trajectories || !lastParsed) return;
  const parts: Array<{ kind: 'ok' | 'warn' | 'error'; text: string }> = [
    { kind: 'ok', text: statusLine(trajectories) },
    ...warningParts(lastParsed, trajectories),
  ];
  const hint = scaleHint(trajectories, logInput.checked);
  if (hint) parts.push({ kind: 'warn', text: hint });
  setMessage(parts);
}

function scaleHint(series: Trajectory[], logY: boolean): string | null {
  if (logY || series.length < 2) return null;
  const peaks = series.map((trajectory) => peakValue(trajectory.values));
  const tallest = peaks.reduce((best, peak) => (peak > best ? peak : best));
  const shortest = peaks.reduce((best, peak) => (peak < best ? peak : best));
  if (shortest < 1n || tallest / shortest < 40n) return null;
  return 'One peak is much taller than the others, so the smaller paths sit near the baseline. Turn on the logarithmic axis to compare them.';
}

function scheduleRender(): void {
  cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(render);
}

function render(): void {
  if (!trajectories || trajectories.length === 0) {
    paintedKey = '';
    view = null;
    plotHost.replaceChildren();
    emptyState.hidden = false;
    hideTooltip();
    return;
  }
  const width = Math.floor(plotHost.clientWidth);
  const height = Math.floor(plotHost.clientHeight);
  if (width < 40 || height < 40) return;
  const key = `${width}x${height}|${logInput.checked ? 1 : 0}|${seriesKey(trajectories)}|${fitKey(fits)}`;
  if (key === paintedKey && view) return;
  paintedKey = key;
  hideTooltip();
  emptyState.hidden = true;
  const layout = buildLayout(trajectories, { width, height, logY: logInput.checked });
  view = renderChart(plotHost, layout, statusLine(trajectories), buildFitPolylines(layout, pngFits(fits)));
}

function computeFits(series: Trajectory[], logSpace: boolean): FitOutcome[] {
  return series.map((trajectory, index) => ({
    seed: trajectory.seed,
    color: SERIES_COLORS[index % SERIES_COLORS.length],
    end: trajectory.values.length - 1,
    approximate: exceedsSafeInteger(trajectory.values),
    result: fitSeries(trajectory.values, { logSpace }),
  }));
}

function pngFits(series: FitOutcome[] | null): PngFit[] {
  if (!series) return [];
  const overlays: PngFit[] = [];
  for (const fit of series) {
    if (!fit.result.ok) continue;
    overlays.push({ color: fit.color, predict: fit.result.predict, start: 0, end: fit.end });
  }
  return overlays;
}

function resetFit(): void {
  fits = null;
  fitBlock.hidden = true;
  fitResults.replaceChildren();
  plotNote.textContent = PLOT_NOTE;
}

function renderFitPanel(): void {
  fitResults.replaceChildren();
  if (!fits || fits.length === 0) {
    fitBlock.hidden = true;
    return;
  }
  fitBlock.hidden = false;
  plotNote.textContent = fits.some((fit) => fit.result.ok) ? PLOT_NOTE_FIT : PLOT_NOTE;
  for (const fit of fits) {
    const card = document.createElement('article');
    card.className = 'fit-card';
    const head = document.createElement('div');
    head.className = 'fit-head';
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = fit.color;
    const title = document.createElement('p');
    title.className = 'legend-seed';
    title.textContent = formatExact(fit.seed);
    head.append(swatch, title);
    card.append(head);

    if (!fit.result.ok) {
      const message = document.createElement('p');
      message.className = 'fit-note';
      message.textContent = fit.result.message;
      card.append(message);
      fitResults.append(card);
      continue;
    }

    const expression = document.createElement('p');
    expression.className = 'fit-expr';
    expression.textContent = fit.result.expression;
    card.append(expression);
    if (fit.result.substitution) {
      const substitution = document.createElement('p');
      substitution.className = 'fit-sub';
      substitution.textContent = fit.result.substitution;
      card.append(substitution);
    }
    const summary = document.createElement('p');
    summary.className = 'fit-summary';
    summary.textContent = fit.result.summary;
    const note = document.createElement('p');
    note.className = 'fit-note';
    note.textContent = fit.approximate
      ? `${fit.result.note} Some terms exceed 2^53 − 1, so this uses the same approximate heights as the chart.`
      : fit.result.note;
    card.append(summary, note);
    fitResults.append(card);
  }
}

function fitKey(series: FitOutcome[] | null): string {
  if (!series) return 'none';
  return series
    .map((fit) => (fit.result.ok ? `${fit.result.logSpace ? 1 : 0}:${fit.result.expression}` : fit.result.message))
    .join('|');
}

function seriesKey(series: Trajectory[]): string {
  return series
    .map((trajectory) => `${trajectory.seed}:${trajectory.values.length}:${trajectory.reachedOne}`)
    .join(',');
}

function warningParts(
  parsed: ReturnType<typeof parseSeeds>,
  series: Trajectory[],
): Array<{ kind: 'warn'; text: string }> {
  const parts: Array<{ kind: 'warn'; text: string }> = [];
  if (parsed.rejected.length > 0) {
    const shown = parsed.rejected.slice(0, 4).map((token) => `“${token}”`).join(', ');
    const more = parsed.rejected.length > 4 ? ` and ${parsed.rejected.length - 4} more` : '';
    parts.push({ kind: 'warn', text: `Skipped ${shown}${more}. Starting values have to be positive integers.` });
  }
  if (parsed.duplicates > 0) {
    parts.push({
      kind: 'warn',
      text: parsed.duplicates === 1 ? 'A repeated seed is drawn once.' : `${parsed.duplicates} repeated seeds are drawn once.`,
    });
  }
  if (parsed.omitted > 0) {
    parts.push({ kind: 'warn', text: `Only the first ${MAX_SEEDS} seeds are plotted.` });
  }
  const capped = series.filter((trajectory) => !trajectory.reachedOne && !trajectory.stoppedForSize);
  if (capped.length > 0) {
    const names = capped.map((trajectory) => formatExact(trajectory.seed)).join(', ');
    parts.push({ kind: 'warn', text: `${names} hit the iteration cap before reaching 1.` });
  }
  const oversized = series.filter((trajectory) => trajectory.stoppedForSize);
  if (oversized.length > 0) {
    const names = oversized.map((trajectory) => formatExact(trajectory.seed)).join(', ');
    parts.push({ kind: 'warn', text: `${names} stopped because a term grew beyond what the chart can draw.` });
  }
  if (series.some((trajectory) => exceedsSafeInteger(trajectory.values))) {
    parts.push({
      kind: 'warn',
      text: 'Some terms are larger than 2^53 − 1, so their vertical position is only approximate.',
    });
  }
  return parts;
}

function statusLine(series: Trajectory[]): string {
  if (series.length === 1) {
    const trajectory = series[0];
    const steps = formatCount(trajectory.values.length - 1);
    const peak = formatExact(peakValue(trajectory.values));
    const seed = formatExact(trajectory.seed);
    if (trajectory.reachedOne) return `Plotted ${seed}. Reached 1 in ${steps} steps; peak ${peak}.`;
    if (trajectory.stoppedForSize) return `Plotted ${seed}. Stopped when values outgrew the chart; peak ${peak}.`;
    return `Plotted ${seed}. Stopped at the cap after ${steps} steps without reaching 1; peak ${peak}.`;
  }
  const reached = series.filter((trajectory) => trajectory.reachedOne).length;
  return `Plotted ${series.length} trajectories. ${reached} of them reached 1.`;
}

function renderLegend(series: Trajectory[] | null): void {
  legend.replaceChildren();
  if (!series || series.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'legend-empty';
    empty.textContent = 'Length and peak show up here after you generate.';
    legend.append(empty);
    return;
  }
  series.forEach((trajectory, index) => {
    const row = document.createElement('article');
    row.className = 'legend-row';
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = SERIES_COLORS[index % SERIES_COLORS.length];
    const body = document.createElement('div');
    const title = document.createElement('p');
    title.className = 'legend-seed';
    title.textContent = formatExact(trajectory.seed);
    const meta = document.createElement('p');
    meta.className = 'legend-meta';
    const steps = formatCount(trajectory.values.length - 1);
    const peak = formatExact(peakValue(trajectory.values));
    meta.textContent = `${steps} steps · peak ${peak}`;
    const state = document.createElement('p');
    state.className = 'legend-state';
    if (trajectory.reachedOne) {
      state.textContent = 'Reached 1';
      state.dataset.state = 'done';
    } else if (trajectory.stoppedForSize) {
      state.textContent = 'Stopped: value too large';
      state.dataset.state = 'warn';
    } else {
      state.textContent = 'Stopped at the iteration cap';
      state.dataset.state = 'warn';
    }
    body.append(title, meta, state);
    row.append(swatch, body);
    legend.append(row);
  });
}

function setMessage(parts: Array<{ kind: 'ok' | 'warn' | 'error'; text: string }>): void {
  message.replaceChildren();
  if (parts.length === 0) return;
  for (const part of parts) {
    const line = document.createElement('p');
    line.dataset.kind = part.kind;
    line.textContent = part.text;
    message.append(line);
  }
}

function showTooltip(hit: HoverHit, clientX: number, clientY: number): void {
  tooltip.replaceChildren();
  const heading = document.createElement('p');
  heading.className = 'tip-step';
  heading.textContent = `Iteration ${formatCount(hit.step)}`;
  const list = document.createElement('ul');
  for (const entry of hit.entries) {
    const item = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = entry.color;
    const seed = document.createElement('span');
    seed.className = 'tip-seed';
    seed.textContent = formatExact(entry.seed);
    const value = document.createElement('span');
    value.className = 'tip-value';
    value.textContent = formatExact(entry.exact);
    if (entry.peak) {
      const tag = document.createElement('span');
      tag.className = 'tip-peak';
      tag.textContent = 'peak';
      value.append(document.createTextNode(' '), tag);
    }
    item.append(swatch, seed, value);
    list.append(item);
  }
  tooltip.append(heading, list);
  tooltip.hidden = false;

  const frame = tooltip.offsetParent as HTMLElement | null;
  if (!frame) return;
  const rect = frame.getBoundingClientRect();
  let left = clientX - rect.left + 16;
  let top = clientY - rect.top + 16;
  const boundsW = frame.clientWidth;
  const boundsH = frame.clientHeight;
  if (left + tooltip.offsetWidth > boundsW - 8) left = clientX - rect.left - tooltip.offsetWidth - 14;
  if (top + tooltip.offsetHeight > boundsH - 8) top = clientY - rect.top - tooltip.offsetHeight - 14;
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
}

function hideTooltip(): void {
  tooltip.hidden = true;
  tooltip.replaceChildren();
}

function eventToSvg(svg: SVGSVGElement, event: PointerEvent): { x: number; y: number } | null {
  const matrix = svg.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

function required<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

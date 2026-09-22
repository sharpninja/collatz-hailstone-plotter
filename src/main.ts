import {
  EMERGENCY_ITERATION_CAP,
  exceedsSafeInteger,
  firstCommonValue,
  hailstone,
  peakValue,
  type FirstCommonValue,
  type Trajectory,
} from './collatz';
import {
  SERIES_COLORS,
  buildFitPolylines,
  buildLayout,
  hitTest,
  nearestBeat,
  paintSelection,
  pointInPlot,
  renderChart,
  renderHover,
  stepsInAxisRange,
  svgXToAxis,
  type AxisRange,
  type BeatHit,
  type ChartView,
  type HoverHit,
} from './chart';
import { downloadPng, type PngFit } from './export';
import { fitSeries, type FitResult } from './fit';
import { groupParityForms, oddPrimePowerParitySummary, parityForm, primeParitySummary, primePowerParitySummary, type ParityForm, type ParityGroup } from './parity';
import './style.css';
import { formatCount, formatExact } from './format';
import {
  INSTRUMENTS,
  MAX_PLAY_STEPS,
  TrajectoryPlayer,
  clampStepMs,
  parseInstrument,
  scoreTrajectory,
  type InstrumentId,
  type PlayHands,
  type Score,
} from './sonify';
import {
  MAX_ITERATION_CAP,
  MAX_SEEDS,
  MAX_SEEDS_LIMIT,
  TOTAL_STEP_BUDGET,
  parseMaxIterations,
  parseMaxSeeds,
  parseSeeds,
  type ParsedSeeds,
} from './parse';

const seedsInput = required<HTMLTextAreaElement>('seeds');
const maxInput = required<HTMLInputElement>('max-steps');
const limitIterationsInput = required<HTMLInputElement>('limit-iterations');
const maxSeedsInput = required<HTMLInputElement>('max-seeds');
const logInput = required<HTMLInputElement>('log-scale');
const alignInput = required<HTMLInputElement>('align-plots');
const beatsInput = required<HTMLInputElement>('mark-beats');
const form = required<HTMLFormElement>('controls');
const message = required<HTMLDivElement>('form-message');
const legend = required<HTMLDivElement>('legend');
const plotHost = required<HTMLDivElement>('plot-host');
const emptyState = required<HTMLDivElement>('empty');
const tooltip = required<HTMLDivElement>('tooltip');
const copyToast = required<HTMLParagraphElement>('copy-toast');
const downloadButton = required<HTMLButtonElement>('download');
const fitButton = required<HTMLButtonElement>('fit');
const clearButton = required<HTMLButtonElement>('clear');
const fitBlock = required<HTMLElement>('fit-block');
const fitResults = required<HTMLDivElement>('fit-results');
const plotNote = required<HTMLParagraphElement>('plot-note');
const patternsBlock = required<HTMLElement>('patterns-block');
const patternsHeading = required<HTMLHeadingElement>('patterns-heading');
const patternsNote = required<HTMLParagraphElement>('patterns-note');
const patterns = required<HTMLDivElement>('patterns');
const commonBlock = required<HTMLElement>('common-block');
const commonValue = required<HTMLParagraphElement>('common-value');
const commonNote = required<HTMLParagraphElement>('common-note');
const playButton = required<HTMLButtonElement>('play');
const pauseButton = required<HTMLButtonElement>('pause-audio');
const stopButton = required<HTMLButtonElement>('stop-audio');
const stepMsInput = required<HTMLInputElement>('step-ms');
const rightHandInput = required<HTMLInputElement>('hand-right');
const leftHandInput = required<HTMLInputElement>('hand-left');
const rightInstrumentSelect = required<HTMLSelectElement>('instrument-right');
const leftInstrumentSelect = required<HTMLSelectElement>('instrument-left');
const playSeedSelect = required<HTMLSelectElement>('play-seed');
const playStatus = required<HTMLParagraphElement>('play-status');
const playbackRangeLabel = required<HTMLParagraphElement>('playback-range');
const clearSelectionButton = required<HTMLButtonElement>('clear-selection');
const levelBar = required<HTMLSpanElement>('level');
const playerRoot = required<HTMLDivElement>('player');
const player = new TrajectoryPlayer();

const PLAY_HINT =
  'Play sounds one seed. The right hand states each odd-exponent prime power on the beat. The left hand rolls the other terms afterward: a low note, a fifth above it, then the pitch. Each hand has its own instrument, and both start as piano. Each climb swells and each partial descent eases before the next swell. The line rests only when a descent reaches a power of 2 and walks down through 4 → 2 → 1. Pitch follows log₂ of the value on a C-major pentatonic from C2 to C6. Original figures, exploratory, not a proof.';

const PLOT_NOTE =
  'The curve passes through every term. Hover a step to read it. Only those terms are Collatz values — the bend between them is a guide.';
const PLOT_NOTE_FIT =
  'The curve passes through every term. The dashed line is only a visual fit of those samples. The sidebar gives the exact form in N for each seed’s parity pattern. Hover a step to read a term.';
const PLOT_NOTE_EXACT =
  'The curve passes through every term. The sidebar gives the exact form in N for this seed’s parity pattern. Hover a step to read a term.';
const BEAT_NOTE =
  'Rings mark beats: terms that are prime powers with an odd exponent. The terms between them are the rest of the path.';

interface FitOutcome {
  seed: bigint;
  color: string;
  end: number;
  steps: number;
  peak: bigint;
  reachedOne: boolean;
  stoppedForSize: boolean;
  approximate: boolean;
  parity: ParityForm;
  result: FitResult;
}

let trajectories: Trajectory[] | null = null;
let lastParsed: ParsedSeeds | null = null;
let seedCap = MAX_SEEDS;
/** True when the plot on screen was drawn with the user iteration cap. */
let iterationLimitEnabled = true;
let fits: FitOutcome[] | null = null;
let view: ChartView | null = null;
let renderFrame = 0;
let paintedKey = '';
/** Inclusive playback window in current axis coordinates. Shared by every series. */
let playbackRange: AxisRange | null = null;
let brush: {
  pointerId: number;
  originAxis: number;
  originX: number;
  currentAxis: number;
  moved: boolean;
  beat: BeatHit | null;
} | null = null;
let copyToastTimer = 0;

const BRUSH_MIN_PX = 6;

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

alignInput.addEventListener('change', () => {
  if (playbackRange || brush) clearPlaybackRange();
  if (!trajectories) return;
  showStatus();
  scheduleRender();
});

beatsInput.addEventListener('change', () => {
  applyPlotNote();
  if (!trajectories) return;
  scheduleRender();
});

downloadButton.addEventListener('click', () => {
  if (!trajectories || trajectories.length === 0) return;
  downloadPng(trajectories, logInput.checked, pngFits(fits), alignInput.checked, beatsInput.checked);
});

fitButton.addEventListener('click', () => {
  if (!trajectories || trajectories.length === 0) return;
  fits = computeFits(trajectories, logInput.checked);
  renderFitPanel();
  scheduleRender();
});

playButton.addEventListener('click', () => {
  if (player.state === 'paused') {
    const trajectory = selectedTrajectory();
    const score = trajectory ? scoreForPlayback(trajectory) : null;
    if (!trajectory || !score) return;
    player.play(score, readStepMs(), readHands(), playerHooks());
    syncTransport();
    return;
  }
  startPlayback();
});

pauseButton.addEventListener('click', () => {
  player.pause();
  syncTransport();
});

stopButton.addEventListener('click', () => {
  player.stop();
  levelBar.style.width = '0';
  syncTransport();
});

playSeedSelect.addEventListener('change', () => {
  if (player.state !== 'idle') {
    player.stop();
    levelBar.style.width = '0';
  }
  syncTransport();
});

limitIterationsInput.addEventListener('change', syncIterationLimitField);

rightInstrumentSelect.addEventListener('change', onInstrumentChange);
leftInstrumentSelect.addEventListener('change', onInstrumentChange);

clearSelectionButton.addEventListener('click', () => {
  clearPlaybackRange();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!brush && !playbackRange) return;
  clearPlaybackRange();
});

clearButton.addEventListener('click', () => {
  player.stop();
  levelBar.style.width = '0';
  resetPlaybackRange();
  seedsInput.value = '';
  maxInput.value = '10000';
  limitIterationsInput.checked = true;
  syncIterationLimitField();
  maxSeedsInput.value = String(MAX_SEEDS);
  seedCap = MAX_SEEDS;
  iterationLimitEnabled = true;
  logInput.checked = false;
  alignInput.checked = false;
  trajectories = null;
  lastParsed = null;
  view = null;
  paintedKey = '';
  hideTooltip();
  setMessage([]);
  renderLegend(null);
  renderPatterns(null);
  renderCommon(null);
  resetFit();
  syncTransport();
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

plotHost.addEventListener('pointerdown', (event) => {
  if (!view || event.button !== 0) return;
  const point = eventToSvg(view.svg, event);
  if (!point || !pointInPlot(view.layout, point.x, point.y)) {
    if (playbackRange || brush) clearPlaybackRange();
    return;
  }
  const beat = beatsInput.checked ? nearestBeat(view.layout, point.x, point.y, beatHitRadius(view.svg)) : null;
  brush = {
    pointerId: event.pointerId,
    originAxis: svgXToAxis(view.layout, point.x),
    originX: point.x,
    currentAxis: svgXToAxis(view.layout, point.x),
    moved: false,
    beat,
  };
  plotHost.classList.remove('is-beat');
  if (!beat) plotHost.classList.add('is-brushing');
  plotHost.setPointerCapture(event.pointerId);
  hideTooltip();
  renderHover(view.hoverLayer, view.layout, null);
  event.preventDefault();
});

plotHost.addEventListener('pointermove', (event) => {
  if (!view) return;
  if (brush && event.pointerId === brush.pointerId) {
    const point = eventToSvg(view.svg, event);
    if (!point) return;
    if (Math.abs(point.x - brush.originX) >= BRUSH_MIN_PX) {
      brush.moved = true;
      plotHost.classList.add('is-brushing');
    }
    brush.currentAxis = svgXToAxis(view.layout, point.x);
    if (brush.moved) {
      paintSelection(view.selectionLayer, view.layout, { start: brush.originAxis, end: brush.currentAxis });
      playbackRangeLabel.textContent = formatPlaybackLabel({ start: brush.originAxis, end: brush.currentAxis });
    }
    hideTooltip();
    renderHover(view.hoverLayer, view.layout, null);
    return;
  }
  const point = eventToSvg(view.svg, event);
  if (!point) {
    plotHost.classList.remove('is-beat');
    hideTooltip();
    return;
  }
  const beatHover = beatsInput.checked && nearestBeat(view.layout, point.x, point.y, beatHitRadius(view.svg));
  plotHost.classList.toggle('is-beat', Boolean(beatHover));
  const hit = hitTest(view.layout, point.x, point.y);
  renderHover(view.hoverLayer, view.layout, hit);
  if (!hit) {
    hideTooltip();
    return;
  }
  showTooltip(hit, event.clientX, event.clientY);
});

plotHost.addEventListener('pointerup', (event) => {
  if (!brush || event.pointerId !== brush.pointerId) return;
  const finished = brush;
  brush = null;
  plotHost.classList.remove('is-brushing');
  if (plotHost.hasPointerCapture(event.pointerId)) plotHost.releasePointerCapture(event.pointerId);
  if (!finished.moved || !view) {
    if (finished.beat && !finished.moved) void copyBeatValue(finished.beat.exact);
    applySelectionBand();
    syncPlaybackRangeLabel();
    return;
  }
  commitPlaybackRange({ start: finished.originAxis, end: finished.currentAxis });
});

plotHost.addEventListener('pointercancel', (event) => {
  if (!brush || event.pointerId !== brush.pointerId) return;
  brush = null;
  plotHost.classList.remove('is-brushing');
  applySelectionBand();
  syncPlaybackRangeLabel();
});

plotHost.addEventListener('pointerleave', () => {
  if (brush) return;
  plotHost.classList.remove('is-beat');
  hideTooltip();
  if (view) renderHover(view.hoverLayer, view.layout, null);
});

const observer = new ResizeObserver(() => scheduleRender());
observer.observe(plotHost);

syncIterationLimitField();
fillInstrumentSelect(rightInstrumentSelect, loadInstrument('hailstone.instrument.right'));
fillInstrumentSelect(leftInstrumentSelect, loadInstrument('hailstone.instrument.left'));
generate();

function syncIterationLimitField(): void {
  maxInput.disabled = !limitIterationsInput.checked;
}

function generate(): void {
  const maxSeeds = parseMaxSeeds(maxSeedsInput.value);
  if (maxSeeds === null) {
    abandonPlot();
    setMessage([
      {
        kind: 'error',
        text: `Set max seeds to a whole number from 1 to ${formatCount(MAX_SEEDS_LIMIT)}.`,
      },
    ]);
    return;
  }
  seedCap = maxSeeds;
  const parsed = parseSeeds(seedsInput.value, maxSeeds);
  const maxIterations = parseMaxIterations(maxInput.value);
  if (parsed.emptyPrimes.length > 0 || parsed.emptyPrimePowers.length > 0 || parsed.emptyOddPrimePowers.length > 0) {
    abandonPlot();
    const text = [
      parsed.emptyPrimes.length > 0 ? emptySetMessage(parsed.emptyPrimes, 'primes') : '',
      parsed.emptyPrimePowers.length > 0 ? emptySetMessage(parsed.emptyPrimePowers, 'prime powers') : '',
      parsed.emptyOddPrimePowers.length > 0
        ? emptySetMessage(parsed.emptyOddPrimePowers, 'odd-exponent prime powers')
        : '',
    ]
      .filter((line) => line.length > 0)
      .join(' ');
    setMessage([{ kind: 'error', text }, ...warningParts(parsed, [])]);
    return;
  }
  if (parsed.tooWide.length > 0 || parsed.tooWidePowers.length > 0 || parsed.tooWideOddPowers.length > 0) {
    abandonPlot();
    const text = [
      parsed.tooWide.length > 0 ? tooWideMessage(parsed.tooWide, 'prime') : '',
      parsed.tooWidePowers.length > 0 ? tooWideMessage(parsed.tooWidePowers, 'prime-power') : '',
      parsed.tooWideOddPowers.length > 0 ? tooWideMessage(parsed.tooWideOddPowers, 'odd-exponent prime-power') : '',
    ]
      .filter((line) => line.length > 0)
      .join(' ');
    setMessage([{ kind: 'error', text }, ...warningParts(parsed, [])]);
    return;
  }
  if (parsed.overCap) {
    abandonPlot();
    setMessage([
      {
        kind: 'error',
        text: overCapMessage(seedCap),
      },
      ...warningParts(parsed, []),
    ]);
    return;
  }
  if (parsed.overflow !== null) {
    abandonPlot();
    setMessage([
      {
        kind: 'error',
        text: overflowMessage(parsed.overflow, seedCap),
      },
      ...warningParts(parsed, []),
    ]);
    return;
  }
  if (parsed.seeds.length === 0) {
    abandonPlot();
    const lead =
      parsed.rejected.length > 0
        ? 'None of those tokens are positive integers.'
        : 'Enter one or more positive integers.';
    setMessage([{ kind: 'error', text: lead }, ...warningParts(parsed, [])]);
    return;
  }
  const limitIterations = limitIterationsInput.checked;
  const iterationCap = limitIterations ? maxIterations : EMERGENCY_ITERATION_CAP;
  if (limitIterations && iterationCap === null) {
    setMessage([
      {
        kind: 'error',
        text: `Set the iteration cap to a whole number from 1 to ${formatCount(MAX_ITERATION_CAP)}.`,
      },
    ]);
    return;
  }
  if (limitIterations && iterationCap !== null && parsed.seeds.length * iterationCap > TOTAL_STEP_BUDGET) {
    setMessage([
      {
        kind: 'error',
        text: `That would allow more than ${formatCount(TOTAL_STEP_BUDGET)} steps in total. Use fewer seeds or a lower cap.`,
      },
    ]);
    return;
  }

  player.stop();
  levelBar.style.width = '0';
  resetPlaybackRange();
  lastParsed = parsed;
  iterationLimitEnabled = limitIterations;
  trajectories = parsed.seeds.map((seed) => hailstone(seed, iterationCap ?? EMERGENCY_ITERATION_CAP));
  downloadButton.disabled = false;
  fitButton.disabled = false;
  resetFit();
  showStatus();
  renderLegend(trajectories);
  renderPatterns(trajectories);
  renderCommon(trajectories);
  syncTransport();
  scheduleRender();
}

function selectedTrajectory(): Trajectory | null {
  if (!trajectories || trajectories.length === 0) return null;
  const index = Number(playSeedSelect.value);
  if (!Number.isInteger(index) || index < 0 || index >= trajectories.length) return trajectories[0];
  return trajectories[index];
}

function readStepMs(): number {
  return clampStepMs(Number(stepMsInput.value));
}

function readHands(): PlayHands {
  return {
    right: rightHandInput.checked,
    left: leftHandInput.checked,
    rightInstrument: parseInstrument(rightInstrumentSelect.value),
    leftInstrument: parseInstrument(leftInstrumentSelect.value),
  };
}

function fillInstrumentSelect(select: HTMLSelectElement, selected: InstrumentId): void {
  select.replaceChildren();
  for (const instrument of INSTRUMENTS) {
    const option = document.createElement('option');
    option.value = instrument.id;
    option.textContent = instrument.label;
    select.append(option);
  }
  select.value = selected;
}

function loadInstrument(key: string): InstrumentId {
  try {
    return parseInstrument(localStorage.getItem(key));
  } catch {
    return 'piano';
  }
}

function storeInstruments(): void {
  try {
    localStorage.setItem('hailstone.instrument.right', rightInstrumentSelect.value);
    localStorage.setItem('hailstone.instrument.left', leftInstrumentSelect.value);
  } catch {
    // Storage can be blocked. The menus still hold the choice for this page.
  }
}

function onInstrumentChange(): void {
  storeInstruments();
  if (player.state === 'playing' || player.state === 'starting') {
    player.stop();
    levelBar.style.width = '0';
    startPlayback();
    return;
  }
  if (player.state === 'paused') {
    player.stop();
    levelBar.style.width = '0';
    syncTransport();
  }
}

function playerHooks(): { onFrame: (frame: { step: number; steps: number; level: number }) => void; onEnded: () => void } {
  return {
    onFrame: (frame) => {
      const trajectory = selectedTrajectory();
      const prefix = trajectory ? `${formatExact(trajectory.seed)} · ` : '';
      playStatus.textContent = `${prefix}Step ${formatCount(frame.step)} of ${formatCount(frame.steps)}.`;
      levelBar.style.width = `${Math.round(frame.level * 100)}%`;
      updateTransportButtons();
    },
    onEnded: () => {
      levelBar.style.width = '0';
      syncTransport();
    },
  };
}

function orderedRange(range: AxisRange): AxisRange {
  return {
    start: Math.min(range.start, range.end),
    end: Math.max(range.start, range.end),
  };
}

function formatPlaybackLabel(range: AxisRange | null): string {
  if (!range) return 'Playback: full path';
  const span = orderedRange(range);
  return `Playback: iterations ${formatCount(span.start)}–${formatCount(span.end)}`;
}

function syncPlaybackRangeLabel(): void {
  playbackRangeLabel.textContent = formatPlaybackLabel(playbackRange);
  clearSelectionButton.disabled = playbackRange === null;
}

function applySelectionBand(): void {
  if (!view) return;
  paintSelection(view.selectionLayer, view.layout, playbackRange);
}

function resetPlaybackRange(): void {
  playbackRange = null;
  brush = null;
  plotHost.classList.remove('is-brushing');
  syncPlaybackRangeLabel();
  applySelectionBand();
}

function clearPlaybackRange(): void {
  const wasBusy = player.state !== 'idle';
  resetPlaybackRange();
  if (!wasBusy) return;
  player.stop();
  levelBar.style.width = '0';
  syncTransport();
}

function commitPlaybackRange(range: AxisRange): void {
  playbackRange = orderedRange(range);
  if (player.state !== 'idle') {
    player.stop();
    levelBar.style.width = '0';
  }
  syncPlaybackRangeLabel();
  applySelectionBand();
  syncTransport();
}

function scoreForPlayback(trajectory: Trajectory): Score | null {
  if (!playbackRange || !view) return scoreTrajectory(trajectory);
  const window = stepsInAxisRange(
    trajectory.values.length - 1,
    view.layout.maxStep,
    view.layout.align,
    playbackRange,
  );
  if (!window) return null;
  const score = scoreTrajectory(trajectory, MAX_PLAY_STEPS, window);
  return score.notes.length === 0 ? null : score;
}

function startPlayback(): void {
  const trajectory = selectedTrajectory();
  if (!trajectory) return;
  if (!rightHandInput.checked && !leftHandInput.checked) {
    playStatus.textContent = 'Turn on the right hand, the left hand, or both.';
    return;
  }
  const score = scoreForPlayback(trajectory);
  if (!score) {
    playStatus.textContent = `Nothing in that range for ${formatExact(trajectory.seed)}.`;
    return;
  }
  player.play(score, readStepMs(), readHands(), playerHooks());
  let detail = '';
  if (score.truncated && playbackRange) {
    detail = ` Playing the first ${formatCount(score.notes.length)} steps of iterations ${formatCount(playbackRange.start)}–${formatCount(playbackRange.end)}.`;
  } else if (score.truncated) {
    detail = ` Playing the first ${formatCount(score.notes.length)} of ${formatCount(score.totalSteps)} steps.`;
  } else if (playbackRange) {
    detail = ` Iterations ${formatCount(playbackRange.start)}–${formatCount(playbackRange.end)}.`;
  }
  playStatus.textContent = `Playing ${formatExact(trajectory.seed)}.${detail}`;
  syncTransport();
}

function updateTransportButtons(): void {
  const busy = player.state === 'playing' || player.state === 'starting' || player.state === 'paused';
  const hasSeeds = (trajectories?.length ?? 0) > 0;
  playButton.disabled = !hasSeeds || player.state === 'playing' || player.state === 'starting';
  pauseButton.disabled = player.state !== 'playing';
  stopButton.disabled = !busy;
  playSeedSelect.disabled = !hasSeeds;
  playerRoot.dataset.state = player.state;
}

function syncTransport(): void {
  const busy = player.state === 'playing' || player.state === 'starting' || player.state === 'paused';
  updateTransportButtons();
  const previous = playSeedSelect.value;
  playSeedSelect.replaceChildren();
  trajectories?.forEach((trajectory, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = formatExact(trajectory.seed);
    playSeedSelect.append(option);
  });
  if (previous && [...playSeedSelect.options].some((option) => option.value === previous)) {
    playSeedSelect.value = previous;
  }
  if (!busy) playStatus.textContent = PLAY_HINT;
}

function abandonPlot(): void {
  player.stop();
  levelBar.style.width = '0';
  resetPlaybackRange();
  trajectories = null;
  view = null;
  downloadButton.disabled = true;
  fitButton.disabled = true;
  resetFit();
  renderPatterns(null);
  renderLegend(null);
  renderCommon(null);
  syncTransport();
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
  if (alignInput.checked && trajectories.length > 1) {
    parts.push({
      kind: 'warn',
      text: 'Align is on: every path ends together at 1. Shorter seeds start later on the axis.',
    });
  }
  setMessage(parts);
}

function scaleHint(series: Trajectory[], logY: boolean): string | null {
  if (logY || series.length < 2) return null;
  const peaks = series.map((trajectory) => peakValue(trajectory.values));
  const tallest = peaks.reduce((best, peak) => (peak > best ? peak : best));
  const shortest = peaks.reduce((best, peak) => (peak < best ? peak : best));
  if (shortest < 1n || tallest / shortest < 40n) return null;
  return 'One peak is much taller than the others, so the smaller paths sit near the baseline. Turn on the logarithmic axis to compare true values.';
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
  const key = `${width}x${height}|${logInput.checked ? 1 : 0}|${alignInput.checked ? 1 : 0}|${beatsInput.checked ? 1 : 0}|${seriesKey(trajectories)}|${fitKey(fits)}`;
  if (key === paintedKey && view) return;
  paintedKey = key;
  hideTooltip();
  emptyState.hidden = true;
  const layout = buildLayout(trajectories, {
    width,
    height,
    logY: logInput.checked,
    align: alignInput.checked,
  });
  const summary = alignInput.checked
    ? `${statusLine(trajectories)} Paths are shifted so they all end at 1.`
    : statusLine(trajectories);
  view = renderChart(plotHost, layout, summary, buildFitPolylines(layout, pngFits(fits)), beatsInput.checked);
  applySelectionBand();
}

function computeFits(series: Trajectory[], logSpace: boolean): FitOutcome[] {
  return series.map((trajectory, index) => ({
    seed: trajectory.seed,
    color: SERIES_COLORS[index % SERIES_COLORS.length],
    end: trajectory.values.length - 1,
    steps: trajectory.values.length - 1,
    peak: peakValue(trajectory.values),
    reachedOne: trajectory.reachedOne,
    stoppedForSize: trajectory.stoppedForSize,
    approximate: exceedsSafeInteger(trajectory.values),
    parity: parityForm(trajectory.values, trajectory),
    result: fitSeries(trajectory.values, { logSpace }),
  }));
}

function pngFits(series: FitOutcome[] | null): PngFit[] {
  if (!series) return [];
  const overlays: PngFit[] = [];
  for (const fit of series) {
    if (!fit.result.ok) continue;
    overlays.push({
      color: fit.color,
      predict: fit.result.predict,
      start: 0,
      end: fit.end,
      peak: Number(fit.peak),
    });
  }
  return overlays;
}

function resetFit(): void {
  fits = null;
  fitBlock.hidden = true;
  fitResults.replaceChildren();
  applyPlotNote();
}

function applyPlotNote(): void {
  const base = !fits || fits.length === 0 ? PLOT_NOTE : fits.some((fit) => fit.result.ok) ? PLOT_NOTE_FIT : PLOT_NOTE_EXACT;
  plotNote.textContent = beatsInput.checked ? `${base} ${BEAT_NOTE}` : base;
}

function renderFitPanel(): void {
  fitResults.replaceChildren();
  if (!fits || fits.length === 0) {
    fitBlock.hidden = true;
    return;
  }
  fitBlock.hidden = false;
  applyPlotNote();
  if (lastParsed?.primeOnly && fits.length > 1) {
    const forms = groupParityForms(fits.map((fit) => fit.parity));
    fitResults.append(
      paragraph(
        'fit-summary',
        `${primeParitySummary(fits.length, forms.length)} This compares the primes on the chart. It is not a proof for every prime, or for every starting value.`,
      ),
    );
  } else if (lastParsed?.primePowerOnly && fits.length > 1) {
    const forms = groupParityForms(fits.map((fit) => fit.parity));
    fitResults.append(
      paragraph(
        'fit-summary',
        `${primePowerParitySummary(fits.length, forms.length)} This compares the prime powers on the chart. It is not a proof for every prime power, or for every starting value.`,
      ),
    );
  } else if (lastParsed?.oddPrimePowerOnly && fits.length > 1) {
    const forms = groupParityForms(fits.map((fit) => fit.parity));
    fitResults.append(
      paragraph(
        'fit-summary',
        `${oddPrimePowerParitySummary(fits.length, forms.length)} This compares that stress-test sample on the chart. It is not a proof for every such seed, or for every starting value.`,
      ),
    );
  }
  for (const fit of fits) {
    fitResults.append(renderFitCard(fit));
  }
  if (fits.length > 1) fitResults.append(renderExplore(fits));
}

function renderFitCard(fit: FitOutcome): HTMLElement {
  const card = document.createElement('article');
  card.className = 'fit-card';
  const head = document.createElement('div');
  head.className = 'fit-head';
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = fit.color;
  const title = document.createElement('p');
  title.className = 'legend-seed';
  title.textContent = `N = ${formatExact(fit.seed)}`;
  head.append(swatch, title);
  card.append(head, kicker('Exact for this parity pattern', false), paragraph('fit-expr', fit.parity.expression));
  card.append(paragraph('fit-sub', fit.parity.parameters));
  if (fit.parity.solvedForSeed) {
    card.append(paragraph('fit-sub', fit.parity.solvedForSeed));
    card.append(paragraph('fit-summary', 'Solving for N recovers this starting value.'));
  }
  card.append(paragraph('fit-note', fit.parity.note));
  if (fit.parity.terms && fit.parity.terms.length > 1) {
    const details = document.createElement('details');
    details.className = 'fit-terms';
    const summary = document.createElement('summary');
    summary.textContent = 'Every term of this parity pattern';
    const list = document.createElement('pre');
    list.className = 'fit-term-list';
    list.textContent = fit.parity.terms.join('\n');
    details.append(summary, list);
    card.append(details);
  } else if (!fit.parity.terms && fit.steps > 0) {
    card.append(paragraph('fit-note', 'Every term has this shape. Only the last term is written out.'));
  }

  if (fit.steps < 1) return card;
  card.append(kicker('Visual fit of the plotted path', true));
  if (!fit.result.ok) {
    card.append(paragraph('fit-note', `${fit.result.message} The identity above is still exact for the parity pattern.`));
    return card;
  }
  card.append(paragraph('fit-expr', fit.result.expression));
  if (fit.result.substitution) card.append(paragraph('fit-sub', fit.result.substitution));
  card.append(paragraph('fit-summary', fit.result.summary));
  const visualNote = fit.approximate
    ? `${fit.result.note} Some terms exceed 2^53 − 1, so this curve uses the same approximate heights as the chart. It is not a function of N.`
    : `${fit.result.note} This polynomial is a guide for the chart, not a function of N.`;
  card.append(paragraph('fit-note', visualNote));
  return card;
}

function renderExplore(fits: FitOutcome[]): HTMLElement {
  const block = document.createElement('section');
  block.className = 'explore';
  const heading = document.createElement('h3');
  heading.textContent = 'Across these seeds';
  const note = document.createElement('p');
  note.className = 'fit-note';
  note.textContent =
    'Exploratory only: stopping time, peak, odd-step count o, and divisions by 2 for the seeds on the chart. This is a way to look for a pattern in N. Nothing here is fitted across seeds, and it is not a proof that every N reaches 1.';
  const list = document.createElement('ul');
  list.className = 'explore-list';
  for (const fit of fits) {
    const item = document.createElement('li');
    const status = fit.reachedOne ? `${formatCount(fit.steps)} steps` : fit.stoppedForSize ? `stopped at ${formatCount(fit.steps)} steps` : `capped at ${formatCount(fit.steps)} steps`;
    item.textContent = `${formatExact(fit.seed)} · ${status} · peak ${formatExact(fit.peak)} · o = ${formatCount(fit.parity.oddSteps)} · e = ${formatCount(fit.parity.divisions)}`;
    list.append(item);
  }
  block.append(heading, note, list);
  return block;
}

function kicker(text: string, quiet: boolean): HTMLParagraphElement {
  const node = document.createElement('p');
  node.className = quiet ? 'fit-kicker quiet' : 'fit-kicker';
  node.textContent = text;
  return node;
}

function paragraph(className: string, text: string): HTMLParagraphElement {
  const node = document.createElement('p');
  node.className = className;
  node.textContent = text;
  return node;
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

function overCapMessage(cap: number): string {
  const limit = `At most ${formatCount(cap)} can be plotted.`;
  if (cap >= MAX_SEEDS_LIMIT) return `That includes more than ${formatCount(cap)} seeds. ${limit}`;
  return `That includes more than ${formatCount(cap)} seeds. ${limit} Raise Max seeds to plot if you want a larger set (up to ${formatCount(MAX_SEEDS_LIMIT)}).`;
}

function overflowMessage(count: bigint, cap: number): string {
  const size = `That expands to ${formatExact(count)} seeds. At most ${formatCount(cap)} can be plotted.`;
  if (count <= BigInt(cap)) return size;
  if (count <= BigInt(MAX_SEEDS_LIMIT)) {
    return `${size} Raise Max seeds to plot to at least ${formatExact(count)}.`;
  }
  return `${size} Max seeds to plot only goes up to ${formatCount(MAX_SEEDS_LIMIT)}.`;
}

function emptySetMessage(ranges: string[], noun: string): string {
  if (ranges.length === 1) return `No ${noun} in ${ranges[0]}.`;
  if (ranges.length === 2) return `No ${noun} in ${ranges[0]} or ${ranges[1]}.`;
  return `No ${noun} in ${ranges.slice(0, -1).join(', ')}, or ${ranges[ranges.length - 1]}.`;
}

function tooWideMessage(ranges: string[], noun: string): string {
  if (ranges.length === 1) return `The ${noun} range ${ranges[0]} is too wide to expand. Shorten it.`;
  return `Those ${noun} ranges are too wide to expand. Shorten them.`;
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
    parts.push({
      kind: 'warn',
      text: `Only the first ${formatCount(seedCap)} seeds are plotted. ${formatCount(parsed.omitted)} more were skipped.`,
    });
  }
  if (parsed.reversed > 0) {
    parts.push({
      kind: 'warn',
      text:
        parsed.reversed === 1
          ? 'A reversed range is read from the smaller number up to the larger one.'
          : 'Reversed ranges are read from the smaller number up to the larger one.',
    });
  }
  const capped = series.filter((trajectory) => !trajectory.reachedOne && !trajectory.stoppedForSize);
  if (capped.length > 0) {
    const names = capped.map((trajectory) => formatExact(trajectory.seed)).join(', ');
    const reason = iterationLimitEnabled
      ? 'hit the iteration cap before reaching 1.'
      : `hit the emergency ceiling of ${formatCount(EMERGENCY_ITERATION_CAP)} steps before reaching 1.`;
    parts.push({ kind: 'warn', text: `${names} ${reason}` });
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
    if (!iterationLimitEnabled) {
      return `Plotted ${seed}. Stopped at the emergency ceiling of ${formatCount(EMERGENCY_ITERATION_CAP)} steps without reaching 1; peak ${peak}.`;
    }
    return `Plotted ${seed}. Stopped at the cap after ${steps} steps without reaching 1; peak ${peak}.`;
  }
  const reached = series.filter((trajectory) => trajectory.reachedOne).length;
  return `Plotted ${series.length} trajectories. ${reached} of them reached 1.`;
}

function renderCommon(series: Trajectory[] | null): void {
  const found = series && series.length >= 2 ? firstCommonValue(series) : null;
  if (!found) {
    commonBlock.hidden = true;
    commonValue.textContent = '';
    commonNote.textContent = '';
    return;
  }
  commonBlock.hidden = false;
  if (found.none) {
    commonValue.textContent = 'No shared value';
    commonNote.textContent = iterationLimitEnabled
      ? 'These runs do not share a term. Raise the iteration cap, or turn the limit off, and they may meet.'
      : 'These runs do not share a term before the emergency ceiling.';
    return;
  }
  if (found.onlyAtOne || found.value === null) {
    commonValue.textContent = 'Meet only at 1';
    commonNote.textContent = '1 is the only value in every sequence.';
    return;
  }
  commonValue.textContent = formatExact(found.value);
  commonNote.textContent = joinNote(found);
}

function joinNote(found: FirstCommonValue): string {
  const value = found.value === null ? '1' : formatExact(found.value);
  const latest = found.hits.reduce((best, hit) => (hit.index > best.index ? hit : best), found.hits[0]);
  if (!latest || found.hits.length > 8) {
    const count = formatCount(found.hits.length);
    if (!latest) return `All ${count} sequences reach ${value}.`;
    return `All ${count} sequences reach ${value}. The latest is ${formatExact(latest.seed)} at step ${formatCount(latest.index)}.`;
  }
  const parts = found.hits.map((hit) => `${formatExact(hit.seed)} at step ${formatCount(hit.index)}`);
  const list =
    parts.length <= 2
      ? parts.join(' and ')
      : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
  return `All ${formatCount(found.hits.length)} sequences reach ${value}. ${list}.`;
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
    } else if (iterationLimitEnabled) {
      state.textContent = 'Stopped at the iteration cap';
      state.dataset.state = 'warn';
    } else {
      state.textContent = 'Stopped at the emergency ceiling';
      state.dataset.state = 'warn';
    }
    body.append(title, meta, state);
    row.append(swatch, body);
    legend.append(row);
  });
}

function renderPatterns(series: Trajectory[] | null): void {
  patterns.replaceChildren();
  if (!series || series.length < 2) {
    patternsBlock.hidden = true;
    patternsHeading.textContent = 'Distinct functions';
    patternsNote.textContent = '';
    return;
  }
  const groups = groupParityForms(series.map((trajectory) => parityForm(trajectory.values, trajectory)));
  const colors = new Map(
    series.map((trajectory, index) => [trajectory.seed.toString(), SERIES_COLORS[index % SERIES_COLORS.length]]),
  );
  patternsBlock.hidden = false;
  if (lastParsed?.primeOnly) {
    const formWord = groups.length === 1 ? 'form' : 'forms';
    const primeWord = series.length === 1 ? 'prime' : 'primes';
    patternsHeading.textContent = `Distinct functions (${formatCount(groups.length)} ${formWord} among ${formatCount(series.length)} ${primeWord})`;
    patternsNote.textContent = `${primeParitySummary(series.length, groups.length)} Seeds that share a parity pattern share one formula in N: the same odd-step count o, the same divisions e, and the same constant m. This compares the primes on the chart. It is not a proof for every prime, or for every starting value.`;
  } else if (lastParsed?.primePowerOnly) {
    const formWord = groups.length === 1 ? 'form' : 'forms';
    const powerWord = series.length === 1 ? 'prime power' : 'prime powers';
    patternsHeading.textContent = `Distinct functions (${formatCount(groups.length)} ${formWord} among ${formatCount(series.length)} ${powerWord})`;
    patternsNote.textContent = `${primePowerParitySummary(series.length, groups.length)} Seeds that share a parity pattern share one formula in N: the same odd-step count o, the same divisions e, and the same constant m. This compares the prime powers on the chart. It is not a proof for every prime power, or for every starting value.`;
  } else if (lastParsed?.oddPrimePowerOnly) {
    const formWord = groups.length === 1 ? 'form' : 'forms';
    patternsHeading.textContent = `Distinct functions (${formatCount(groups.length)} ${formWord} among ${formatCount(series.length)} odd-exponent prime powers)`;
    patternsNote.textContent = `${oddPrimePowerParitySummary(series.length, groups.length)} Seeds that share a parity pattern share one formula in N: the same odd-step count o, the same divisions e, and the same constant m. This compares that stress-test sample on the chart. It is not a proof for every such seed, or for every starting value.`;
  } else {
    const noun = groups.length === 1 ? 'pattern' : 'patterns';
    patternsHeading.textContent = `Distinct functions (${formatCount(groups.length)} unique ${noun})`;
    patternsNote.textContent =
      'Seeds that share a parity pattern share one formula in N: the same odd-step count o, the same divisions e, and the same constant m. A different seed can take a different pattern. This describes the paths on the chart. It is not a proof for every starting value.';
  }
  groups.forEach((group, index) => patterns.append(renderPatternCard(group, index, colors)));
}

function renderPatternCard(group: ParityGroup, index: number, colors: Map<string, string>): HTMLElement {
  const card = document.createElement('article');
  card.className = 'fit-card';
  const title = document.createElement('p');
  title.className = 'fit-kicker';
  title.textContent = `Function ${index + 1}`;
  const seeds = document.createElement('p');
  seeds.className = 'pattern-seeds';
  seeds.append(document.createTextNode('Seeds: '));
  group.seeds.forEach((seed, seedIndex) => {
    if (seedIndex > 0) seeds.append(document.createTextNode(', '));
    const chip = document.createElement('span');
    chip.className = 'pattern-seed';
    chip.style.color = colors.get(seed.toString()) ?? '';
    chip.textContent = formatExact(seed);
    seeds.append(chip);
  });
  card.append(title, paragraph('fit-expr', group.expression), paragraph('fit-sub', group.parameters), seeds);
  if (group.solvedForSeed) card.append(paragraph('fit-sub', group.solvedForSeed));
  return card;
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
  heading.textContent = `Iterations to 1 · ${formatCount(hit.step)}`;
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
    value.textContent = hit.align
      ? `step ${formatCount(entry.step)} · ${formatExact(entry.exact)}`
      : formatExact(entry.exact);
    if (entry.peak) {
      const tag = document.createElement('span');
      tag.className = 'tip-peak';
      tag.textContent = 'peak';
      value.append(document.createTextNode(' '), tag);
    }
    if (entry.beat) {
      const tag = document.createElement('span');
      tag.className = 'tip-peak';
      tag.textContent = 'beat';
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

function beatHitRadius(svg: SVGSVGElement): number {
  const matrix = svg.getScreenCTM();
  if (!matrix) return 14;
  const origin = new DOMPoint(0, 0).matrixTransform(matrix);
  const unit = new DOMPoint(1, 0).matrixTransform(matrix);
  const scale = Math.hypot(unit.x - origin.x, unit.y - origin.y);
  if (scale <= 0) return 14;
  return Math.max(8, 14 / scale);
}

async function copyBeatValue(exact: bigint): Promise<void> {
  const text = exact.toString();
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    copied = copyWithTextarea(text);
  }
  showCopyToast(copied ? `Copied ${text}` : 'Copy failed.');
}

function copyWithTextarea(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

function showCopyToast(text: string): void {
  copyToast.hidden = false;
  copyToast.textContent = text;
  window.clearTimeout(copyToastTimer);
  copyToastTimer = window.setTimeout(() => {
    copyToast.hidden = true;
  }, 1600);
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

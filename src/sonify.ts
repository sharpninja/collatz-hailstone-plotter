import type { Trajectory } from './collatz';
import { isOddPrimePower } from './parse';

/** C2. The low end of the sounding range. */
export const MIDI_LOW = 36;
/** C6. The high end of the sounding range. */
export const MIDI_HIGH = 84;
/**
 * log₂(n) from 0 through this value fills C2–C6.
 * 2^16 = 65,536, which covers the peak of 27 (9,232) with room above it.
 */
export const LOG_SPAN = 16;
/** Steps scheduled in one performance. Longer paths play this prefix. */
export const MAX_PLAY_STEPS = 2_000;
export const STEP_MS_DEFAULT = 140;
export const STEP_MS_MIN = 40;
export const STEP_MS_MAX = 600;
/** Left hand lags by half a step, the /2 offset. Cadence notes ignore this. */
export const LEFT_HAND_LAG = 0.5;

const PENTATONIC = [0, 2, 4, 7, 9];

export type Hand = 'right' | 'left' | 'both';

export interface PlannedNote {
  step: number;
  value: bigint;
  /** Right: odd-exponent prime power. Left: every other term. Both: final powers of 2. */
  hand: Hand;
  midi: number;
}

export interface Score {
  seed: bigint;
  notes: PlannedNote[];
  /** First step of the closing power-of-two run, or `notes.length` when there is none. */
  cadenceAt: number;
  totalSteps: number;
  truncated: boolean;
}

export function isPowerOfTwo(n: bigint): boolean {
  return n > 0n && (n & (n - 1n)) === 0n;
}

/** log₂ for values past 2^53, using the leading bits plus the bit length. */
export function log2Of(n: bigint): number {
  if (n <= 1n) return 0;
  const bits = n.toString(2);
  const exponent = bits.length - 1;
  const width = Math.min(bits.length, 24);
  const head = Number.parseInt(bits.slice(0, width), 2);
  return Math.log2(head) + (exponent - (width - 1));
}

/** C-major pentatonic (C D E G A) inside C2–C6. Ties snap downward. */
export function midiForValue(n: bigint): number {
  const raw = MIDI_LOW + (Math.min(LOG_SPAN, Math.max(0, log2Of(n))) / LOG_SPAN) * (MIDI_HIGH - MIDI_LOW);
  return nearestPentatonic(raw);
}

export function cadenceIndex(values: readonly bigint[]): number {
  if (values.length === 0) return 0;
  let index = values.length - 1;
  if (!isPowerOfTwo(values[index])) return values.length;
  while (index > 0 && isPowerOfTwo(values[index - 1])) index -= 1;
  return index;
}

export function scoreTrajectory(trajectory: Trajectory, maxSteps = MAX_PLAY_STEPS): Score {
  const totalSteps = trajectory.values.length;
  const limit = Math.max(0, Math.min(maxSteps, totalSteps));
  const values = trajectory.values.slice(0, limit);
  const fullCadence = cadenceIndex(trajectory.values);
  const cadenceAt = fullCadence >= limit ? limit : fullCadence;
  const notes: PlannedNote[] = values.map((value, step) => ({
    step,
    value,
    hand: step >= cadenceAt ? 'both' : isOddPrimePower(value) ? 'right' : 'left',
    midi: midiForValue(value),
  }));
  enforceCadenceDescent(notes, cadenceAt);
  return {
    seed: trajectory.seed,
    notes,
    cadenceAt,
    totalSteps,
    truncated: limit < totalSteps,
  };
}

export function clampStepMs(value: number): number {
  if (!Number.isFinite(value)) return STEP_MS_DEFAULT;
  return Math.min(STEP_MS_MAX, Math.max(STEP_MS_MIN, Math.round(value)));
}

function nearestPentatonic(midi: number): number {
  let best = MIDI_LOW;
  let bestDist = Infinity;
  for (const note of pentatonicScale()) {
    const dist = Math.abs(note - midi);
    if (dist < bestDist || (dist === bestDist && note < best)) {
      bestDist = dist;
      best = note;
    }
  }
  return best;
}

function pentatonicScale(): number[] {
  const notes: number[] = [];
  for (let midi = MIDI_LOW; midi <= MIDI_HIGH; midi += 1) {
    if (PENTATONIC.includes(midi % 12)) notes.push(midi);
  }
  return notes;
}

/** Keep the closing powers of 2 on a strictly descending line. */
function enforceCadenceDescent(notes: PlannedNote[], cadenceAt: number): void {
  const scale = pentatonicScale();
  let previous = MIDI_HIGH + 1;
  for (const note of notes) {
    if (note.step < cadenceAt) continue;
    if (note.midi < previous) {
      previous = note.midi;
      continue;
    }
    const lowered = [...scale].reverse().find((midi) => midi < previous) ?? MIDI_LOW;
    note.midi = lowered;
    previous = lowered;
  }
}

export interface PlayHands {
  right: boolean;
  left: boolean;
}

interface LiveNote {
  time: number;
  midi: number;
  kind: 'right' | 'left';
  ring: boolean;
}

export function schedulePlan(score: Score, stepMs: number, hands: PlayHands): LiveNote[] {
  const stepSec = clampStepMs(stepMs) / 1000;
  const plan: LiveNote[] = [];
  for (const note of score.notes) {
    const ring = note.value === 1n;
    if (note.hand === 'right' && hands.right) {
      plan.push({ time: note.step * stepSec, midi: note.midi, kind: 'right', ring });
    } else if (note.hand === 'left' && hands.left) {
      plan.push({ time: note.step * stepSec + LEFT_HAND_LAG * stepSec, midi: note.midi, kind: 'left', ring });
    } else if (note.hand === 'both') {
      if (hands.right) plan.push({ time: note.step * stepSec, midi: note.midi, kind: 'right', ring });
      if (hands.left) plan.push({ time: note.step * stepSec, midi: note.midi, kind: 'left', ring });
    }
  }
  return plan;
}

const RIGHT_PARTIALS = [1, 0.62, 0.38, 0.22, 0.12, 0.06];
const LEFT_PARTIALS = [1, 0.28, 0.1, 0.04];

export interface PlayerHooks {
  onFrame?: (frame: { step: number; steps: number; level: number }) => void;
  onEnded?: () => void;
}

/**
 * Piano-like two-voice playback. One AudioContext is reused.
 * Pause suspends the context, so already-scheduled notes hold their place.
 */
export class TrajectoryPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private noise: AudioBuffer | null = null;
  private sources: AudioScheduledSourceNode[] = [];
  private raf = 0;
  private startedAt = 0;
  private endAt = 0;
  private stepSec = STEP_MS_DEFAULT / 1000;
  private steps = 0;
  private hooks: PlayerHooks = {};
  private token = 0;
  state: 'idle' | 'starting' | 'playing' | 'paused' = 'idle';

  play(score: Score, stepMs: number, hands: PlayHands, hooks: PlayerHooks = {}): void {
    if (this.state === 'paused') {
      this.hooks = hooks;
      const token = this.token;
      void this.ctx?.resume().then(() => {
        if (token !== this.token || this.state !== 'paused') return;
        this.state = 'playing';
        this.watch();
      });
      return;
    }
    if (this.state === 'playing' || this.state === 'starting') return;
    const plan = schedulePlan(score, stepMs, hands);
    this.hooks = hooks;
    this.steps = score.notes.length;
    this.stepSec = clampStepMs(stepMs) / 1000;
    this.stopSources();
    const ctx = this.ensureContext();
    const token = ++this.token;
    this.state = 'starting';
    void ctx.resume().then(() => {
      if (token !== this.token || this.ctx !== ctx) return;
      const start = ctx.currentTime + 0.06;
      let last = start;
      for (const note of plan) {
        const at = start + note.time;
        this.strike(ctx, at, note.midi, note.kind, note.ring);
        const release = note.ring ? 2.4 : note.kind === 'right' ? 0.72 : 0.55;
        if (at + release > last) last = at + release;
      }
      this.startedAt = start;
      this.endAt = plan.length === 0 ? start + 0.1 : last;
      this.state = 'playing';
      this.watch();
    });
  }

  pause(): void {
    if (this.state !== 'playing' || !this.ctx) return;
    this.state = 'paused';
    cancelAnimationFrame(this.raf);
    void this.ctx.suspend();
  }

  stop(): void {
    this.token += 1;
    cancelAnimationFrame(this.raf);
    this.stopSources();
    this.state = 'idle';
    this.startedAt = 0;
    this.endAt = 0;
    if (this.ctx?.state === 'running') void this.ctx.suspend();
  }

  level(): number {
    const analyser = this.analyser;
    if (!analyser || this.state === 'idle') return 0;
    const bins = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(bins);
    let sum = 0;
    for (const sample of bins) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }
    return Math.min(1, Math.sqrt(sum / bins.length) * 4);
  }

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    master.connect(compressor);
    compressor.connect(analyser);
    analyser.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    this.analyser = analyser;
    return ctx;
  }

  private strike(ctx: AudioContext, time: number, midi: number, kind: 'right' | 'left', ring: boolean): void {
    const master = this.master;
    if (!master) return;
    const freq = 440 * 2 ** ((midi - 69) / 12);
    const partials = kind === 'right' ? RIGHT_PARTIALS : LEFT_PARTIALS;
    const peak = kind === 'right' ? 0.2 : 0.075;
    const attack = kind === 'right' ? 0.006 : 0.018;
    const decay = ring ? 2.2 : kind === 'right' ? 0.62 : 0.48;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(peak, time + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
    amp.connect(master);
    partials.forEach((weight, index) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * (index + 1), time);
      const partial = ctx.createGain();
      partial.gain.value = weight;
      osc.connect(partial);
      partial.connect(amp);
      osc.start(time);
      osc.stop(time + attack + decay + 0.02);
      this.sources.push(osc);
    });
    this.hammer(ctx, time, kind === 'right' ? 0.045 : 0.02);
  }

  private hammer(ctx: AudioContext, time: number, gain: number): void {
    const master = this.master;
    if (!master) return;
    if (!this.noise) {
      const length = Math.floor(ctx.sampleRate * 0.03);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1400;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, time);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    src.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    src.start(time);
    src.stop(time + 0.03);
    this.sources.push(src);
  }

  private watch(): void {
    cancelAnimationFrame(this.raf);
    const tick = (): void => {
      if (this.state !== 'playing' || !this.ctx) return;
      const elapsed = this.ctx.currentTime - this.startedAt;
      const step =
        elapsed < 0 || this.steps === 0 ? 0 : Math.min(this.steps, Math.floor(elapsed / this.stepSec) + 1);
      this.hooks.onFrame?.({ step, steps: this.steps, level: this.level() });
      if (this.ctx.currentTime >= this.endAt) {
        this.stopSources();
        this.state = 'idle';
        this.hooks.onEnded?.();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopSources(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped at its scheduled end.
      }
      source.disconnect();
    }
    this.sources = [];
  }
}

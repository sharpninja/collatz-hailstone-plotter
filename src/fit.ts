/**
 * Least-squares fit of a plotted hailstone path.
 *
 * Searches polynomials in the iteration, through degree 5, in the same space
 * as the chart: the value itself, or log₁₀ of the value when the log axis is
 * on. BIC picks the degree so a jagged path does not collect extra wiggles.
 * The result approximates the samples. It is not a closed form for Collatz.
 */

const MAX_DEGREE = 5;
const SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

export interface FitSuccess {
  ok: true;
  /** Rounded formula, including the left-hand side. */
  expression: string;
  /** Definition of t for a centered polynomial, when the fit uses one. */
  substitution: string | null;
  /** Family, sample count, R², and RMSE. */
  summary: string;
  /** How closely the smooth curve can follow this path. */
  note: string;
  r2: number;
  rmse: number;
  samples: number;
  logSpace: boolean;
  /** Collatz value at a real iteration. The overlay uses this, not the rounded expression. */
  predict: (iteration: number) => number;
}

export interface FitFailure {
  ok: false;
  message: string;
}

export type FitResult = FitSuccess | FitFailure;

interface Model {
  degree: number;
  coeffs: number[];
  center: number;
  scale: number;
  r2: number;
  rmse: number;
  bic: number;
  perfect: boolean;
}

export function fitSeries(values: readonly bigint[], options: { logSpace: boolean }): FitResult {
  if (values.length < 2) {
    return {
      ok: false,
      message:
        values.length === 0
          ? 'There are no terms to fit.'
          : 'This trajectory has a single term, so there is no curve to fit.',
    };
  }

  const raw = values.map((value) => Number(value));
  if (raw.some((value) => !Number.isFinite(value))) {
    return { ok: false, message: 'A term is too large to fit in ordinary precision.' };
  }
  if (options.logSpace && raw.some((value) => value <= 0)) {
    return { ok: false, message: 'A logarithmic fit needs every term to be positive.' };
  }

  const target = options.logSpace ? raw.map((value) => Math.log10(value)) : raw;
  const xs = target.map((_, index) => index);
  const model = selectModel(xs, target);
  if (!model) {
    return { ok: false, message: 'Could not fit a stable polynomial to these samples.' };
  }

  const predictTarget = (iteration: number) => evaluate(model, iteration);
  const predict = options.logSpace ? (iteration: number) => 10 ** predictTarget(iteration) : predictTarget;
  const lhs = options.logSpace ? 'log₁₀(value)' : 'value';
  const written = writeModel(model, lhs);

  return {
    ok: true,
    expression: written.expression,
    substitution: written.substitution,
    summary: `${familyLabel(model.degree, options.logSpace)} · ${formatCount(values.length)} samples · R² ${formatR2(model.r2)} · RMSE ${formatMeasure(model.rmse)}${options.logSpace ? ' (log₁₀)' : ''}`,
    note: qualityNote(model.r2, model.degree, values.length, options.logSpace, wideRange(raw)),
    r2: model.r2,
    rmse: model.rmse,
    samples: values.length,
    logSpace: options.logSpace,
    predict,
  };
}

function selectModel(xs: number[], ys: number[]): Model | null {
  const n = ys.length;
  let mean = 0;
  for (const y of ys) mean += y;
  mean /= n;
  let ssTot = 0;
  let peak = 1;
  for (const y of ys) {
    ssTot += (y - mean) ** 2;
    peak = Math.max(peak, Math.abs(y));
  }
  const flat = ssTot <= 1e-18 * n * peak * peak;
  const maxDegree = flat ? 0 : Math.min(MAX_DEGREE, Math.max(1, n - 2));

  let best: Model | null = null;
  for (let degree = 0; degree <= maxDegree; degree++) {
    const fitted = fitDegree(xs, ys, degree);
    if (!fitted) continue;
    const scored = score(xs, ys, (x) => evaluate(fitted, x), degree, ssTot, peak);
    const model: Model = { ...fitted, ...scored, degree };
    if (!best || prefer(model, best)) best = model;
  }
  return best;
}

function prefer(next: Model, current: Model): boolean {
  if (next.perfect !== current.perfect) return next.perfect;
  if (next.perfect && current.perfect) return next.degree < current.degree;
  if (next.bic < current.bic - 1e-6) return true;
  if (Math.abs(next.bic - current.bic) <= 1e-6 && next.degree < current.degree) return true;
  return false;
}

function fitDegree(
  xs: number[],
  ys: number[],
  degree: number,
): { coeffs: number[]; center: number; scale: number } | null {
  const n = xs.length;
  let center = 0;
  for (const x of xs) center += x;
  center /= n;
  if (degree === 0) return { coeffs: [average(ys)], center, scale: 1 };

  let variance = 0;
  for (const x of xs) variance += (x - center) ** 2;
  const scale = Math.sqrt(variance / n) || 1;
  const columns = degree + 1;
  const normal = Array.from({ length: columns }, () => Array<number>(columns).fill(0));
  const rhs = Array<number>(columns).fill(0);

  for (let i = 0; i < n; i++) {
    const powers = monomials((xs[i] - center) / scale, degree);
    for (let row = 0; row < columns; row++) {
      rhs[row] += powers[row] * ys[i];
      for (let col = 0; col < columns; col++) normal[row][col] += powers[row] * powers[col];
    }
  }

  const coeffs = solve(normal, rhs);
  if (!coeffs) return null;
  return { coeffs, center, scale };
}

function score(
  xs: number[],
  ys: number[],
  predict: (x: number) => number,
  degree: number,
  ssTot: number,
  peak: number,
): { r2: number; rmse: number; bic: number; perfect: boolean } {
  const n = ys.length;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const error = ys[i] - predict(xs[i]);
    ssRes += error * error;
  }
  const noiseFloor = 1e-18 * n * peak * peak;
  const perfect = ssTot <= noiseFloor || ssRes <= noiseFloor || (ssTot > 0 && 1 - ssRes / ssTot >= 1 - 1e-9);
  const r2 = ssTot <= noiseFloor ? 1 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));
  const rmse = Math.sqrt(ssRes / n);
  const k = degree + 1;
  const bic = perfect || ssRes <= 0 ? Number.NEGATIVE_INFINITY : n * Math.log(ssRes / n) + k * Math.log(n);
  return { r2: perfect ? 1 : r2, rmse: perfect ? 0 : rmse, bic, perfect };
}

function evaluate(model: { coeffs: number[]; center: number; scale: number }, iteration: number): number {
  const t = (iteration - model.center) / model.scale;
  let value = 0;
  let power = 1;
  for (const coeff of model.coeffs) {
    value += coeff * power;
    power *= t;
  }
  return value;
}

function monomials(t: number, degree: number): number[] {
  const powers = [1];
  for (let power = 1; power <= degree; power++) powers.push(powers[power - 1] * t);
  return powers;
}

function average(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** Gaussian elimination with partial pivoting. Returns null when the system is singular. */
function solve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const rows = matrix.map((row, index) => [...row, rhs[index]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    }
    const pivotValue = rows[pivot][col];
    if (!Number.isFinite(pivotValue) || Math.abs(pivotValue) < 1e-12) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    for (let row = col + 1; row < n; row++) {
      const factor = rows[row][col] / rows[col][col];
      rows[row][col] = 0;
      for (let j = col + 1; j <= n; j++) rows[row][j] -= factor * rows[col][j];
    }
  }
  const solution = Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let value = rows[row][n];
    for (let col = row + 1; col < n; col++) value -= rows[row][col] * solution[col];
    const diag = rows[row][row];
    if (!Number.isFinite(diag) || Math.abs(diag) < 1e-12) return null;
    solution[row] = value / diag;
  }
  return solution;
}

function writeModel(model: Model, lhs: string): { expression: string; substitution: string | null } {
  if (model.degree <= 1) {
    const slope = model.degree === 0 ? 0 : model.coeffs[1] / model.scale;
    const intercept = model.coeffs[0] - slope * model.center;
    return { expression: `${lhs} ≈ ${formatAffine(intercept, slope, 'iteration')}`, substitution: null };
  }
  return {
    expression: `${lhs} ≈ ${formatPolynomial(model.coeffs, 't')}`,
    substitution: formatSubstitution(model.center, model.scale),
  };
}

function formatSubstitution(center: number, scale: number): string {
  const shifted = snap(center) === 0 ? 'iteration' : `(iteration − ${formatPivot(center)})`;
  if (snap(scale) === 1) return `t = ${shifted}`;
  return `t = ${shifted} / ${formatPivot(scale)}`;
}

function formatAffine(intercept: number, slope: number, variable: string): string {
  const slopeText = formatSlopeTerm(slope, variable);
  const interceptValue = snap(intercept);
  if (!slopeText) return formatSigned(interceptValue);
  if (interceptValue === 0) return slopeText;
  const interceptText = formatSigned(interceptValue);
  if (slopeText.startsWith('−')) return `${interceptText} − ${slopeText.slice(1)}`;
  return `${interceptText} + ${slopeText}`;
}

function formatSlopeTerm(slope: number, variable: string): string | null {
  const snapped = snap(slope);
  if (snapped === 0) return null;
  const body = Math.abs(snapped) === 1 ? variable : `${formatMagnitude(Math.abs(snapped))}·${variable}`;
  return snapped < 0 ? `−${body}` : body;
}

function formatPolynomial(coeffs: number[], variable: string): string {
  const pieces: string[] = [];
  coeffs.forEach((coeff, power) => {
    const snapped = snap(coeff);
    if (snapped === 0) return;
    const factor = power === 0 ? '' : power === 1 ? variable : `${variable}${superscript(power)}`;
    const magnitude = Math.abs(snapped);
    const body = power === 0 || magnitude !== 1 ? `${formatMagnitude(magnitude)}${factor ? `·${factor}` : ''}` : factor;
    pieces.push(snapped < 0 ? `−${body}` : body);
  });
  if (pieces.length === 0) return '0';
  return pieces
    .map((piece, index) => {
      if (index === 0) return piece;
      return piece.startsWith('−') ? `− ${piece.slice(1)}` : `+ ${piece}`;
    })
    .join(' ');
}

function familyLabel(degree: number, logSpace: boolean): string {
  const names = ['Constant', 'Linear', 'Quadratic', 'Cubic', 'Quartic', 'Quintic'];
  const name = names[degree] ?? `Degree ${degree}`;
  if (degree === 0) return logSpace ? 'Constant in log₁₀(value)' : 'Constant';
  if (!logSpace) return degree === 1 ? 'Linear' : `${name} polynomial`;
  return `${name} in log₁₀(value)`;
}

function wideRange(values: number[]): boolean {
  let low = Infinity;
  let high = 0;
  for (const value of values) {
    if (value <= 0) continue;
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return Number.isFinite(low) && low > 0 && high / low >= 40;
}

function qualityNote(r2: number, degree: number, samples: number, logSpace: boolean, wide: boolean): string {
  if (degree === 0 && r2 > 0.999) return 'Every plotted sample has the same height.';
  const where = logSpace ? 'on the logarithmic axis' : 'on the linear axis';
  const short =
    samples < 8
      ? ' Only a few samples are plotted, so a close match does not mean later terms follow this formula.'
      : '';
  const logHint =
    !logSpace && wide && r2 < 0.75
      ? ' Turn on the logarithmic axis to fit log₁₀(value), which often follows a hailstone path more closely.'
      : '';
  if (r2 >= 0.85) return `Tracks the plotted samples closely ${where}.${short}${logHint}`;
  if (r2 >= 0.6) return `Follows the overall shape ${where}. The step-to-step jumps stay in the residual.${short}${logHint}`;
  if (r2 >= 0.3) return `A rough envelope ${where}. The hailstone spikes rise above this smooth curve.${short}${logHint}`;
  return `A weak match ${where}. This path is too irregular for a low-degree polynomial.${short}${logHint}`;
}

function formatR2(r2: number): string {
  if (!Number.isFinite(r2)) return '—';
  return Math.max(0, Math.min(1, r2)).toFixed(3);
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function formatMeasure(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.001 || abs >= 1e7)) {
    const exp = Math.floor(Math.log10(abs));
    const mantissa = abs / 10 ** exp;
    const sign = value < 0 ? '−' : '';
    return `${sign}${trimZeros(mantissa.toPrecision(3))}×10${superscript(exp)}`;
  }
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

function formatSigned(value: number): string {
  const snapped = snap(value);
  if (snapped === 0) return '0';
  const text = formatMagnitude(Math.abs(snapped));
  return snapped < 0 ? `−${text}` : text;
}

function formatMagnitude(value: number): string {
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs >= 1e6 || abs < 1e-3) {
    let exp = Math.floor(Math.log10(abs));
    let mantissa = abs / 10 ** exp;
    if (mantissa >= 9.9995) {
      mantissa /= 10;
      exp += 1;
    }
    return `${trimZeros(mantissa.toPrecision(4))}×10${superscript(exp)}`;
  }
  const snapped = Number(abs.toPrecision(4));
  if (Number.isInteger(snapped)) return snapped.toLocaleString('en-US');
  return snapped.toLocaleString('en-US', { maximumSignificantDigits: 4 });
}

function formatPivot(value: number): string {
  const integer = nearlyInteger(value);
  if (integer !== null) return integer.toLocaleString('en-US');
  const digits = Math.abs(value) >= 100 ? 1 : Math.abs(value) >= 10 ? 2 : 3;
  return Number(value.toFixed(digits)).toLocaleString('en-US', { maximumFractionDigits: digits });
}

function snap(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const integer = nearlyInteger(value);
  if (integer !== null) return integer;
  if (Math.abs(value) < 1e-12) return 0;
  const snapped = Number(value.toPrecision(4));
  return Object.is(snapped, -0) ? 0 : snapped;
}

function nearlyInteger(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  const tolerance = 1e-8 * Math.max(1, Math.abs(rounded));
  return Math.abs(value - rounded) <= tolerance ? rounded : null;
}

function superscript(value: number): string {
  return String(value).replace('-', '⁻').replace(/\d/g, (digit) => SUPERSCRIPTS[Number(digit)]);
}

function trimZeros(text: string): string {
  return text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/**
 * Exact form of one hailstone path in its starting value N.
 *
 * Even steps divide by 2. Odd steps send n to 3n+1. Composing those affine
 * maps keeps every term in the shape (3^o · N + m) / 2^e. Here o counts odd
 * steps, e counts divisions by 2, and m is an integer fixed by the order of
 * those steps. The order is this seed's parity pattern. A different seed can
 * take a different pattern, so the same o, e, and m are not a proof for every N.
 */

/** Paths longer than this still report the final identity, without a line per term. */
const TERM_LIST_LIMIT = 400;

export interface ParityForm {
  seed: bigint;
  oddSteps: number;
  divisions: number;
  offset: bigint;
  value: bigint;
  reachedOne: boolean;
  stoppedForSize: boolean;
  /** (3^o · N + m) / 2^e = last term, with this path's o and e filled in. */
  expression: string;
  /** o, e, and the constant m. */
  parameters: string;
  /** Rearrangement that isolates N, when the path reached 1. */
  solvedForSeed: string | null;
  /** Every plotted term matched the affine form. */
  exact: boolean;
  /** One equation per term, including the start. Null when the run is very long. */
  terms: string[] | null;
  note: string;
}

export function parityForm(
  values: readonly bigint[],
  status: { reachedOne: boolean; stoppedForSize: boolean },
): ParityForm {
  const seed = values[0] ?? 0n;
  let oddSteps = 0;
  let divisions = 0;
  let offset = 0n;
  let power3 = 1n;
  let power2 = 1n;
  let exact = values.length > 0 && (power3 * seed + offset) / power2 === seed;
  const listTerms = values.length > 0 && values.length <= TERM_LIST_LIMIT;
  const terms: string[] = [];
  if (listTerms && values.length > 0) terms.push(termLine(0, oddSteps, divisions, offset, seed));

  for (let index = 0; index < values.length - 1; index++) {
    if ((values[index] & 1n) === 0n) {
      divisions += 1;
      power2 <<= 1n;
    } else {
      offset = offset * 3n + power2;
      power3 *= 3n;
      oddSteps += 1;
    }
    const value = values[index + 1];
    const numerator = power3 * seed + offset;
    if (power2 === 0n || numerator % power2 !== 0n || numerator / power2 !== value) exact = false;
    if (listTerms) terms.push(termLine(index + 1, oddSteps, divisions, offset, value));
  }

  const value = values.at(-1) ?? 0n;
  const reachedOne = status.reachedOne && value === 1n;
  if (reachedOne) {
    const recovered = oddSteps === 0 ? power2 - offset : (power2 - offset) / power3;
    const divides = oddSteps === 0 ? offset === 0n : (power2 - offset) % power3 === 0n;
    if (!divides || recovered !== seed) exact = false;
  }

  const alreadyOne = values.length === 1 && value === 1n;
  return {
    seed,
    oddSteps,
    divisions,
    offset,
    value,
    reachedOne,
    stoppedForSize: status.stoppedForSize,
    expression: alreadyOne ? 'N = 1' : formatExpression(oddSteps, divisions, value),
    parameters: `o = ${formatCount(oddSteps)} · e = ${formatCount(divisions)} · m = ${formatInteger(offset)}`,
    solvedForSeed: reachedOne && !alreadyOne ? formatSolved(oddSteps, divisions) : null,
    exact,
    terms: listTerms ? terms : null,
    note: describe(status, exact, listTerms, values.length, alreadyOne),
  };
}

function termLine(step: number, oddSteps: number, divisions: number, offset: bigint, value: bigint): string {
  return `${formatCount(step)}: ${formatExpression(oddSteps, divisions, value, offset)}`;
}

/** Headline form uses the symbol m. Term lines can inline the integer. */
function formatExpression(oddSteps: number, divisions: number, value: bigint, inlineOffset?: bigint): string {
  const constant = inlineOffset === undefined ? 'm' : formatInteger(inlineOffset);
  let numerator: string;
  if (oddSteps === 0) numerator = 'N';
  else numerator = `(3^${oddSteps} · N + ${constant})`;
  const body = divisions === 0 ? numerator : `${numerator} / 2^${divisions}`;
  return `${body} = ${formatInteger(value)}`;
}

function formatSolved(oddSteps: number, divisions: number): string {
  if (oddSteps === 0) return `N = 2^${divisions}`;
  return `N = (2^${divisions} − m) / 3^${oddSteps}`;
}

function describe(
  status: { reachedOne: boolean; stoppedForSize: boolean },
  exact: boolean,
  listed: boolean,
  length: number,
  alreadyOne: boolean,
): string {
  if (alreadyOne) {
    return 'The starting value is already 1, so there is no parity pattern to apply. This is not a formula for other seeds.';
  }
  const check = exact
    ? 'Checked against every plotted term.'
    : 'This form did not match the plotted terms.';
  let scope: string;
  if (status.reachedOne) {
    scope =
      "Exact for this N's parity pattern. A different starting value can take a different pattern, so this does not prove the conjecture for every N.";
  } else if (status.stoppedForSize) {
    scope =
      'Exact for the parity pattern before a term outgrew the chart. The path has not reached 1, so this is not a completed map onto 1.';
  } else {
    scope =
      'Exact for the parity pattern before the iteration cap. The path has not reached 1, so this is not a completed map onto 1.';
  }
  const hidden =
    listed || length <= 1
      ? ''
      : ` The term-by-term list is omitted for this ${formatCount(length - 1)}-step run; the identity above is the last term.`;
  return `${scope} ${check}${hidden}`;
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function formatInteger(value: bigint): string {
  const raw = value.toString();
  if (raw.length > 80) return `${raw.slice(0, 8)}…${raw.slice(-4)} (${raw.length} digits)`;
  return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

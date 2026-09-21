export function formatExact(value: bigint): string {
  const raw = value.toString();
  if (raw.length > 24) {
    return `${raw.slice(0, 8)}…${raw.slice(-4)} (${raw.length} digits)`;
  }
  return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function trimScaled(value: number): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return value.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

/** Axis labels: grouped integers through 999,999, then compact suffixes. */
export function formatTick(value: number): string {
  if (!Number.isFinite(value)) return '';
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.001 || abs >= 1e15)) {
    return value.toExponential(2).replace('e+', 'e');
  }
  if (abs >= 1e12) return sign + trimScaled(abs / 1e12) + 'T';
  if (abs >= 1e9) return sign + trimScaled(abs / 1e9) + 'B';
  if (abs >= 1e6) return sign + trimScaled(abs / 1e6) + 'M';
  if (Number.isInteger(abs)) return sign + abs.toLocaleString('en-US');
  return sign + abs.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

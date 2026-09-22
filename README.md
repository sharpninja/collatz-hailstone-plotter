# Collatz Hailstone Plotter

A small static web app that draws hailstone trajectories for the Collatz (3n+1) map.

Enter one or more positive integers. For each seed the app computes

- even n → n / 2
- odd n → 3n + 1

and plots the terms until the value reaches 1. The horizontal axis is the iteration (0, 1, 2, …). The vertical axis is the value at that step. A smooth curve passes through every term so the path is readable; only the dots are actual sequence values. The 4 → 2 → 1 cycle is not repeated.

This is a visualizer. It does not prove the Collatz conjecture, which is still open.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install && npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

Other scripts:

```bash
npm test          # sequence, parsing, and curve checks
npm run build     # typecheck and production bundle
npm run preview   # serve the production bundle
```

No server, account, or database is involved. After `npm install`, the app is fully static.

## Usage

- **Starting values.** One positive integer, or several separated by commas or spaces. `27` is the classic example: 111 steps, climbing to 9,232 before it falls to 1. `25, 26, 27` overlays three paths. A range includes both ends: `20..27` plots eight trajectories, and `1...50` uses the same rule with three dots. `10-20` is also a range. Mix them freely — `3, 10..12, 27` plots 3, 10, 11, 12, and 27, in that order. Seeds stay in first-seen order, and each range expands from its lower end to its higher end. A reversed range such as `27..20` is swapped and read upward. Repeats are drawn once. At most 12 seeds are plotted. Extra individual numbers past that cap are skipped. A range that would expand past 12 is refused, with a count, before any trajectory is computed — `1..100000` stops at that message.
- **Generate.** Computes the sequences and redraws the chart.
- **Identify function.** For each plotted seed, writes the exact form fixed by the parity pattern that run took: every term is (3^o · N + m) / 2^e, where N is the starting value, o counts odd steps, e counts divisions by 2, and m is the constant from the order of those steps. When the path reaches 1, the panel also solves that identity for N. This is exact for the seeds you plotted. It is not a proof for every starting value, because a different N can take a different pattern. A dashed curve is still drawn as a visual polynomial fit of the samples (degree at most 5, chosen with BIC; on a log axis the fit is in log₁₀(value)). With several seeds, the panel lists stopping time, peak, o, and e side by side so you can look for a pattern in N. That comparison is exploratory. It is not a formula fitted across seeds.
- **Max iterations.** Safety cap. A sequence stops early at 1, or when it has taken this many steps (maximum 200,000). The total allowance across every seed is 500,000 steps.
- **Logarithmic value axis.** Useful when one spike towers over the rest of the path. You can toggle it without recomputing.
- **Hover.** Moving across the chart reads the iteration and the value of each seed that is still running at that step.
- **Download PNG.** Saves the current plot, including axes and, when several seeds are shown, a legend.
- **Clear.** Empties the form and the chart.

The curve is a Catmull–Rom spline, drawn as cubic Bézier segments, so each turn is rounded instead of a straight corner. It passes through every sample. Positions between the dots are interpolation only and may bow slightly on a sharp spike; the dots themselves are the sequence.

Sequences are computed with arbitrary-size integers. A term past 2^53 − 1 is still drawn, but its height is approximate, and the chart says so. A term that would exceed about 10^308 stops the run instead of leaving the chart.

## Project layout

- `src/collatz.ts` — the 3n+1 step and the stopping rules
- `src/chart.ts` — scales, the smooth curve, and the SVG chart
- `src/parity.ts` — exact form of one path in its starting value, from the parity pattern
- `src/fit.ts` — visual polynomial fit of a plotted trajectory
- `src/export.ts` — PNG download
- `src/main.ts` — the page controls

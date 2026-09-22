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

- **Starting values.** One positive integer, or several separated by commas or spaces. `27` is the classic example: 111 steps, climbing to 9,232 before it falls to 1. `25, 26, 27` overlays three paths. A range includes both ends: `20..27` plots eight trajectories, and `1...50` uses the same rule with three dots. `10-20` is also a range. Mix them freely — `3, 10..12, 27` plots 3, 10, 11, 12, and 27, in that order. Seeds stay in first-seen order, and each range expands from its lower end to its higher end. A reversed range such as `27..20` is swapped and read upward. Repeats are drawn once. At most 12 seeds are plotted. Extra individual numbers past that cap are skipped. A range that would expand past 12 is refused, with a count, before any trajectory is computed — `1..100000` stops at that message. A prime range plots only the primes in a span, a harder sample to explore. An odd prime steps into 3n+1 immediately, with no leading division by 2, so those curves are often messier and take more iterations. `primes:20..30` plots 23 and 29, while `20..30` still plots every integer from 20 through 30. `p:20..30` and `primes 20..30` mean the same thing, and `primes: 20 .. 30` is fine too. Both ends are included, 1 is not a prime, and `primes:30..20` is swapped just like any other range. `primes:14..16` is an error because that stretch has no prime, and nothing else in the field is plotted until it is fixed. Prime ranges mix with numbers and ordinary ranges — `27, primes:20..40` plots 27, then 23, 29, 31, and 37. A prime range past 12 seeds is refused the same way, with a count when the size is known, and the 500,000-step budget still applies to whatever is plotted. Use the sample to compare those paths and parity forms. 27, the composite above, can take more steps than many primes, so the set is a stress test rather than a list of the longest runs. Comparing the primes does not prove the conjecture, and it does not settle it for every starting value.
- **Generate.** Computes the sequences and redraws the chart.
- **Identify function.** For each plotted seed, writes the exact form fixed by the parity pattern that run took: every term is (3^o · N + m) / 2^e, where N is the starting value, o counts odd steps, e counts divisions by 2, and m is the constant from the order of those steps. When the path reaches 1, the panel also solves that identity for N. This is exact for the seeds you plotted. It is not a proof for every starting value, because a different N can take a different pattern. When every plotted seed comes from a prime range, the panel also states how many distinct parity forms those primes take. That count is only for the primes on the chart. A dashed curve is still drawn as a visual polynomial fit of the samples (degree at most 5, chosen with BIC; on a log axis the fit is in log₁₀(value)). With several seeds, the panel lists stopping time, peak, o, and e side by side so you can look for a pattern in N. That comparison is exploratory. It is not a formula fitted across seeds.
- **Distinct functions.** Whenever two or more trajectories are on the chart, the sidebar groups them by parity pattern. Seeds share a card when they have the same o, the same e, and the same m, so they share one formula in N. A different seed can take a different pattern. A path that reaches 1 usually has its own card, because that formula determines N. A shorter shared prefix can group several seeds: every odd seed, stopped after two steps, is `(3^1 · N + m) / 2^1`. When every plotted seed comes from a prime range, the heading counts how many distinct parity forms those primes take. That count describes the primes on the chart. It is not a proof for every prime.
- **Align / normalize.** Overlays share one iteration axis and one value axis, so a step and a Collatz value land in the same place on every curve. Turn on Align / normalize to compare shape: horizontal position is iteration divided by that path’s stopping time, and height is the value divided by that path’s peak (or the log of each, when the logarithmic axis is also on). Both axes then run from 0 to 1. The default stays absolute iteration against absolute value.
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
- `src/parity.ts` — exact form of one path in its starting value, and grouping of seeds that share that form
- `src/fit.ts` — visual polynomial fit of a plotted trajectory
- `src/export.ts` — PNG download
- `src/main.ts` — the page controls

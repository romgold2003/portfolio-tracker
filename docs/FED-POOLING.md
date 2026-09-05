# How the Fed odds are pooled, and why

Measured on 6 September 2026 against 30 days of history: Polymarket hourly
(744 points), Kalshi hourly (384), fed funds futures daily (22). All three
reduced to one comparable number — the probability of a quarter-point hike at
the September meeting.

## What the data says

### The two prediction markets are one source, not two

| pair | correlation of levels |
|---|---|
| Polymarket · Kalshi | **0.983** |
| Polymarket · futures | 0.771 |
| Kalshi · futures | 0.745 |

Polymarket and Kalshi are all but the same series. Treating them as two
independent votes double-counts one opinion, which is what a naive three-way
average does.

### The futures run high, consistently

Mean level over the window: futures **46.8%**, Polymarket 37.6%, Kalshi 39.7%.

An eight-point standing gap in one direction is the term premium showing up in
the data rather than being assumed — fed funds futures are a hedging instrument
as well as a forecast, and hedgers pay up.

### The futures are also the noisiest

Standard deviation of the daily change:

| source | pts/day |
|---|---|
| futures | **11.23** |
| Kalshi | 8.37 |
| Polymarket | 8.26 |

This is the finding that matters most for watching the panel for a sudden
shift. The deepest market is the one that moves most on its own, so it
generates the most movement that is not news.

### Pooling cuts that noise by a third

| estimator | noise, pts/day |
|---|---|
| futures alone | 11.23 |
| equal-weight pool | 7.55 |
| minimum-variance pool | 7.50 |

The gap between equal weight and the optimal weights is **0.05 pts/day on
twelve observations** — nothing. The gap between pooling and not pooling is a
third of the noise, and is the whole benefit.

### Neither prediction market leads the other

Cross-correlation of hourly changes, Polymarket against Kalshi: 0.48 at zero
lag, and under 0.11 at every lag from ±2h to ±6h. They move together within the
hour. There is no leader to follow.

## What is built

Two blocks, not three sources:

1. **Prediction markets** — Polymarket and Kalshi averaged together first,
   because at 0.98 correlation they are one opinion.
2. **Futures** — on their own.

Combined **30% futures / 70% prediction markets**. That is what minimum-variance
weights give (29.2% to futures on the three-way solve, 28.9% on the two-block
solve) and it is stable across both formulations, which a number derived from
twelve observations needs to be before it is worth trusting.

The weights are not re-fitted live. Twelve daily observations is enough to see
that futures deserve less than a third and not nearly enough to chase decimals;
refitting on every request would be reading noise. They are constants, with this
document as the record of where they came from.

## What was deliberately not done

**No extremizing.** Log-odds pooling with an extremizing factor beats a linear
average when forecasters hold independent information. At 0.98 correlation these
plainly do not. Extremizing here would manufacture confidence from an echo.

**No bias correction on the futures.** The eight-point gap is real, but
down-weighting the futures to 30% *and* subtracting their bias would correct for
the same thing twice.

**The ±50bp outcomes are kept.** They price at well under 1% and look like
clutter. They are also the exact thing a drastic shift would show up in first —
a jump from 0.7% to 8% on a half-point move is the signal, and a panel that had
dropped the outcome could not report it. The bars are hidden while negligible;
the numbers stay in the maths.

## What this does not establish

Which source is *right*. That needs settled meetings scored against what each
predicted beforehand, and this app has no such record. Everything above is about
**agreement and noise**, not accuracy — a quieter estimator is a better alarm,
which is not the same as a better forecast.

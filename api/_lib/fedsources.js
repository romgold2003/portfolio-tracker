/**
 * The odds on the next FOMC decision, pooled across three markets.
 *
 * Three venues price this and they do not agree. On 5 September the fed funds
 * futures implied a 58% chance of a hike while Polymarket said 50% and Kalshi
 * 51% — the two prediction markets agreeing with each other and not with the
 * futures, which is the direction the term premium in futures would predict.
 *
 * Two decisions in here are worth defending, because both could reasonably have
 * gone the other way.
 *
 * **Everything is carried as a full distribution, not three buckets.** Kalshi
 * quotes an eleven-rung ladder and Polymarket five outcomes; collapsing either
 * to cut/hold/raise before pooling throws away the tails, and the tails are
 * where a surprise lives. The buckets are computed at the end, for display.
 *
 * **The pool is linear — a plain average of probabilities — and is not
 * extremized.** The forecasting literature is clear that log-odds pooling with
 * an extremizing factor beats a linear average, and it is equally clear about
 * why: it assumes each forecaster holds independent private information, so the
 * pool should be more confident than any member. That assumption fails badly
 * here. Polymarket and Kalshi traders read CME FedWatch; all three are watching
 * the same statements and the same data. Extremizing correlated forecasts
 * manufactures confidence out of an echo, and on a coin-flip meeting that is
 * exactly the wrong error to make. Linear pooling is the conservative estimator
 * for correlated sources and it is what this uses.
 */

/**
 * The outcome space: change in the target range, in basis points.
 *
 * The ends are open — -50 means "fifty or more off", not exactly fifty — which
 * is how both prediction markets write their own tail legs.
 */
export const OUTCOMES = [-50, -25, 0, 25, 50];

const STEP_BPS = 25;
const empty = () => Object.fromEntries(OUTCOMES.map((b) => [b, 0]));

/**
 * Make a distribution sum to one.
 *
 * A book of binary markets does not add to 100 — each leg carries its own
 * spread, so Polymarket's five legs came to 100.15 — and pooling unnormalised
 * books would weight whichever happened to be quoted widest.
 */
export function normalise(dist) {
  const total = OUTCOMES.reduce((sum, b) => sum + (Number(dist?.[b]) || 0), 0);
  if (!(total > 0)) return null;
  return Object.fromEntries(OUTCOMES.map((b) => [b, Math.max(0, Number(dist[b]) || 0) / total]));
}

/** The top of the target range the Fed is in now, which decisions move from. */
export const currentUpper = (effr, step = 0.25) =>
  Math.round(Math.ceil(effr / step) * step * 100) / 100;

/* ── the three sources ─────────────────────────────────────────────────── */

/**
 * The futures, as a distribution.
 *
 * This is CME's own method and it is worth being explicit that it is a model,
 * not a quote: the contracts price one expected average rate, and turning that
 * into probabilities assumes the whole distribution sits on the two adjacent
 * quarter-point steps either side of it. A market genuinely split between a
 * hold and a fifty is indistinguishable, to this, from one certain of a
 * twenty-five. Neither prediction market needs that assumption — they are asked
 * the question directly — which is the honest argument for not letting the
 * futures dominate the pool however deep they are.
 */
export function fromFutures(changeBps) {
  if (!Number.isFinite(changeBps)) return null;
  const clamped = Math.max(-50, Math.min(50, changeBps));
  const lower = Math.floor(clamped / STEP_BPS) * STEP_BPS;
  const upper = Math.min(50, lower + STEP_BPS);

  const dist = empty();
  const share = (clamped - lower) / STEP_BPS;
  dist[lower] += 1 - share;
  dist[upper] += share;
  return normalise(dist);
}

/**
 * Polymarket's per-meeting book.
 *
 * Five separate binary markets rather than one multi-outcome market, so each is
 * read on its own and mapped by what it is called.
 */
export function fromPolymarket(events, meeting) {
  const [year, month] = String(meeting ?? '').split('-').map(Number);
  const monthName = new Date(Date.UTC(year || 2000, (month || 1) - 1, 1))
    .toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });

  const event = (events ?? []).find((e) =>
    /fed/i.test(e?.title ?? '') && new RegExp(monthName, 'i').test(e?.title ?? ''));
  if (!event?.markets?.length) return null;

  const dist = empty();
  let found = 0;

  for (const m of event.markets) {
    const label = String(m?.groupItemTitle ?? m?.question ?? '');
    let prices;
    try { prices = JSON.parse(m?.outcomePrices ?? '[]'); } catch { continue; }
    // The first outcome is "Yes" — the probability the leg happens.
    const yes = Number(prices?.[0]);
    if (!Number.isFinite(yes)) continue;

    const size = /\b(\d+)\s*\+?\s*bps?\b/i.exec(label);
    const bps = size ? Number(size[1]) : 0;
    const bucket = /no change|hold|unchanged/i.test(label) ? 0
      : /decrease|cut/i.test(label) ? -Math.min(50, bps)
        : /increase|hike/i.test(label) ? Math.min(50, bps) : null;
    if (bucket === null || !(bucket in dist)) continue;

    dist[bucket] += yes;
    found += 1;
  }

  // A book quoting only some of its legs is not a distribution.
  return found >= 3 ? normalise(dist) : null;
}

/**
 * Kalshi's ladder, differenced into the same space.
 *
 * Kalshi quotes cumulative thresholds — "Above 3.75%" — on the target rate after
 * the meeting, so each outcome is the gap between two rungs rather than a leg of
 * its own. Read relative to where the range tops out today.
 *
 * Rungs quoted wider than `maxSpread` are not used: a mid taken from a
 * two-cent market is a number, a mid taken from a fifty-cent market is a guess
 * wearing one.
 */
export function fromKalshi(markets, effr, { step = 0.25, maxSpread = 0.1 } = {}) {
  if (!Array.isArray(markets) || !markets.length || !(effr > 0)) return null;

  const rungs = new Map();
  for (const m of markets) {
    const strike = Number(m?.floor_strike);
    const bid = Number(m?.yes_bid_dollars);
    const ask = Number(m?.yes_ask_dollars);
    if (!Number.isFinite(strike) || !Number.isFinite(bid) || !Number.isFinite(ask)) continue;
    if (ask - bid > maxSpread) continue;
    rungs.set(Math.round(strike * 100) / 100, (bid + ask) / 2);
  }

  const upper = currentUpper(effr, step);
  // P(rate ends above `upper + n steps`), which is P(a hike of more than n).
  const above = (steps) => rungs.get(Math.round((upper + steps * step) * 100) / 100);

  const hikeBig = above(1);
  const hikeAny = above(0);
  const notCut = above(-1);
  const notBigCut = above(-2);
  if (![hikeBig, hikeAny, notCut].every(Number.isFinite)) return null;

  const dist = empty();
  dist[50] = hikeBig;
  dist[25] = hikeAny - hikeBig;
  dist[0] = notCut - hikeAny;
  // The bottom rung is often unquoted because nobody is pricing a deep cut.
  dist[-25] = Number.isFinite(notBigCut) ? notCut - notBigCut : Math.max(0, 1 - notCut);
  dist[-50] = Number.isFinite(notBigCut) ? Math.max(0, 1 - notBigCut) : 0;

  return normalise(dist);
}

/* ── pooling ───────────────────────────────────────────────────────────── */

/**
 * The pooled distribution: a plain average across whatever answered.
 *
 * Equal weights, and that is a judgement rather than a default. Weighting by
 * depth would hand it to the futures, which are orders of magnitude the deepest
 * and are also the only source whose probabilities are derived from a model
 * rather than quoted outright. Weighting by past accuracy would be better still
 * and is not available: it needs aligned historical prices from all three and a
 * settled record to score them against, which this app does not have. Until it
 * does, equal weight is the honest estimator — and it lets two venues that
 * agree outvote one that does not.
 */
export function pool(sources) {
  const usable = (sources ?? []).map((s) => normalise(s?.dist)).filter(Boolean);
  if (!usable.length) return null;

  const out = Object.fromEntries(OUTCOMES.map((b) => [
    b, usable.reduce((sum, d) => sum + d[b], 0) / usable.length,
  ]));
  return normalise(out);
}

/** The three bars the panel draws, from the full distribution. */
export function buckets(dist) {
  if (!dist) return null;
  const sum = (test) => OUTCOMES.filter(test).reduce((s, b) => s + (dist[b] ?? 0), 0);
  return {
    decrease: sum((b) => b < 0),
    hold: dist[0] ?? 0,
    increase: sum((b) => b > 0),
  };
}

/** The likeliest single outcome, which is what the meeting is actually about. */
export function mode(dist) {
  if (!dist) return null;
  const best = OUTCOMES.reduce((a, b) => ((dist[b] ?? 0) > (dist[a] ?? 0) ? b : a), OUTCOMES[0]);
  return { bps: best, probability: dist[best] ?? 0 };
}

/**
 * How far apart the sources are on the outcome they collectively lead with.
 *
 * Reported so the panel can say when they disagree. One number hiding an eight
 * point spread is worse than no number, because it reads as confidence.
 */
export function spread(sources, pooled) {
  const usable = (sources ?? []).map((s) => normalise(s?.dist)).filter(Boolean);
  if (usable.length < 2) return 0;
  const on = mode(pooled ?? pool(sources))?.bps ?? 0;
  const values = usable.map((d) => d[on] ?? 0);
  return Math.round((Math.max(...values) - Math.min(...values)) * 1000) / 10;
}

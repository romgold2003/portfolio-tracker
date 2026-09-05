/**
 * The odds on the next FOMC decision, from more than one market.
 *
 * Three places price this and they do not agree. Fed funds futures are the
 * deepest by far and are what CME's FedWatch reads, but they are a hedging
 * instrument as much as a forecast: the term premium in them biases implied
 * rates upward, which is documented and which shows here — on 5 September the
 * futures implied a 58% chance of a hike while Polymarket said 50% and Kalshi
 * 51%, the two prediction markets agreeing with each other and not with the
 * futures.
 *
 * So the panel reads all three and blends them, and keeps each one so the
 * disagreement stays visible. The spread is not noise to be averaged away — two
 * venues moving together while a third sits eight points off is the interesting
 * state, and hiding it behind one number would throw away the reason for
 * reading more than one source in the first place.
 *
 * Both prediction markets are public and unauthenticated. Neither is asked for
 * anything but prices.
 */

/** The three things the committee can do. Every source is reduced to these. */
const SHAPE = ['decrease', 'hold', 'increase'];

/**
 * Make a distribution sum to one.
 *
 * A book of binary markets does not add to 100 — each leg carries its own
 * spread, so Polymarket's five legs came to 100.15 — and blending unnormalised
 * books would weight whichever happened to be quoted widest.
 */
export function normalise(odds) {
  const total = SHAPE.reduce((sum, k) => sum + (Number(odds?.[k]) || 0), 0);
  if (!(total > 0)) return null;
  return Object.fromEntries(SHAPE.map((k) => [k, (Number(odds[k]) || 0) / total]));
}

/** The top of the target range the Fed is in now, which decisions move from. */
export const currentUpper = (effr, step = 0.25) =>
  Math.round(Math.ceil(effr / step) * step * 100) / 100;

/**
 * Polymarket's per-meeting book.
 *
 * Five separate binary markets — "25 bps increase", "No change" and so on —
 * rather than one multi-outcome market, so each is read on its own and the
 * legs are summed into the three buckets the panel shows.
 */
export function fromPolymarket(events, meeting) {
  const [year, month] = String(meeting ?? '').split('-').map(Number);
  const monthName = new Date(Date.UTC(year || 2000, (month || 1) - 1, 1))
    .toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });

  const event = (events ?? []).find((e) =>
    /fed/i.test(e?.title ?? '') && new RegExp(monthName, 'i').test(e?.title ?? ''));
  if (!event?.markets?.length) return null;

  const odds = { decrease: 0, hold: 0, increase: 0 };
  let found = 0;

  for (const m of event.markets) {
    const label = String(m?.groupItemTitle ?? m?.question ?? '');
    let prices;
    try { prices = JSON.parse(m?.outcomePrices ?? '[]'); } catch { continue; }
    // The first outcome is "Yes" — the probability the leg happens.
    const yes = Number(prices?.[0]);
    if (!Number.isFinite(yes)) continue;

    const bucket = /decrease|cut/i.test(label) ? 'decrease'
      : /increase|hike/i.test(label) ? 'increase'
        : /no change|hold|unchanged/i.test(label) ? 'hold' : null;
    if (!bucket) continue;
    odds[bucket] += yes;
    found += 1;
  }

  return found >= 3 ? normalise(odds) : null;
}

/**
 * Kalshi's ladder, differenced into the three buckets.
 *
 * Kalshi quotes cumulative thresholds — "Above 3.75%", "Above 3.50%" — against
 * the target rate after the meeting, so the answer is not a leg but the gap
 * between two rungs. A hike is the chance of ending above where the range tops
 * out today; a cut is the chance of not clearing the rung a quarter-point below
 * that; and holding is what is left.
 */
export function fromKalshi(markets, effr, step = 0.25) {
  if (!Array.isArray(markets) || !markets.length || !(effr > 0)) return null;

  const rungs = new Map();
  for (const m of markets) {
    const strike = Number(m?.floor_strike);
    const bid = Number(m?.yes_bid_dollars);
    const ask = Number(m?.yes_ask_dollars);
    if (!Number.isFinite(strike) || !Number.isFinite(bid) || !Number.isFinite(ask)) continue;
    // The mid of a two-sided quote, which is the market's own best guess.
    rungs.set(Math.round(strike * 100) / 100, (bid + ask) / 2);
  }

  const upper = currentUpper(effr, step);
  const above = rungs.get(upper);
  const aboveCut = rungs.get(Math.round((upper - step) * 100) / 100);
  if (!Number.isFinite(above) || !Number.isFinite(aboveCut)) return null;

  return normalise({
    increase: above,
    decrease: Math.max(0, 1 - aboveCut),
    hold: Math.max(0, aboveCut - above),
  });
}

/**
 * The blend, equally weighted across whatever answered.
 *
 * Equal rather than weighted by depth, and that is a judgement worth stating.
 * Weighting by size would hand it to the futures, which are orders of magnitude
 * the deepest — and the futures are the one source with a known directional
 * bias. Equal weight lets two venues that agree outvote one that is known to
 * lean, which is the whole reason for reading three.
 */
export function blend(sources) {
  const usable = (sources ?? []).map((s) => normalise(s?.odds)).filter(Boolean);
  if (!usable.length) return null;

  const out = Object.fromEntries(SHAPE.map((k) => [
    k, usable.reduce((sum, o) => sum + o[k], 0) / usable.length,
  ]));
  return normalise(out);
}

/**
 * How far apart the sources are on the likeliest outcome.
 *
 * Reported so the panel can say when they disagree. One number hiding an eight
 * point spread is worse than no number, because it reads as confidence.
 */
export function spread(sources) {
  const usable = (sources ?? []).map((s) => normalise(s?.odds)).filter(Boolean);
  if (usable.length < 2) return 0;
  const widest = SHAPE.map((k) => {
    const values = usable.map((o) => o[k]);
    return Math.max(...values) - Math.min(...values);
  });
  return Math.round(Math.max(...widest) * 1000) / 10;
}

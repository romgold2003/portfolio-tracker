/**
 * Pooling the odds on the Fed across three markets.
 *
 * On 5 September 2026 the fed funds futures implied a 58% chance of a hike
 * while Polymarket said 49% and Kalshi 50% — the two prediction markets
 * agreeing with each other and not with the futures, which is the direction the
 * term premium in futures would predict.
 *
 * Two things are being protected here. The distribution must stay whole:
 * collapsing to cut/hold/raise before pooling throws away the tails, and the
 * tails are where a surprise lives. And the pool must stay conservative —
 * extremizing correlated forecasters manufactures confidence out of an echo,
 * and all three of these are watching the same statements.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  OUTCOMES, normalise, currentUpper, fromFutures, fromPolymarket, fromKalshi,
  pool, buckets, mode, spread,
} from '../api/_lib/fedsources.js';

const pct = (d) => Object.fromEntries(OUTCOMES.map((b) => [b, +((d?.[b] ?? 0) * 100).toFixed(1)]));
const sums = (d) => OUTCOMES.reduce((s, b) => s + d[b], 0);

describe('the shape everything is carried in', () => {
  test('it is a distribution over five outcomes, not three buckets', () => {
    assert.deepEqual(OUTCOMES, [-50, -25, 0, 25, 50]);
  });

  test('a book quoting over 100 is scaled, not trusted', () => {
    // Polymarket's five legs came to 100.15: each carries its own spread.
    const out = normalise({ '-50': 0.0015, '-25': 0.0035, 0: 0.495, 25: 0.495, 50: 0.0065 });
    assert.ok(Math.abs(sums(out) - 1) < 1e-12);
  });

  test('a book of nothing is null rather than five zeroes', () => {
    assert.equal(normalise({}), null);
    assert.equal(normalise(null), null);
  });
});

describe('where the target range sits', () => {
  test('the effective rate is rounded up to the top of its quarter', () => {
    assert.equal(currentUpper(3.63), 3.75);
    assert.equal(currentUpper(4.33), 4.5);
    assert.equal(currentUpper(3.75), 3.75, 'exactly on the top stays there');
  });
});

describe('the futures, as a distribution', () => {
  test('an expected move splits across the two steps around it', () => {
    // +14.57bp is 58.3% of the way from a hold to a quarter-point hike, which
    // is exactly what the panel showed before any of this.
    assert.deepEqual(pct(fromFutures(14.57)), { '-50': 0, '-25': 0, 0: 41.7, 25: 58.3, 50: 0 });
  });

  test('no expected move is all on the hold', () => {
    assert.deepEqual(pct(fromFutures(0)), { '-50': 0, '-25': 0, 0: 100, 25: 0, 50: 0 });
  });

  test('a cut lands on the cut side', () => {
    assert.deepEqual(pct(fromFutures(-12.5)), { '-50': 0, '-25': 50, 0: 50, 25: 0, 50: 0 });
  });

  test('a move past the ends is held at them rather than lost', () => {
    assert.equal(pct(fromFutures(-90))['-50'], 100);
    assert.equal(pct(fromFutures(200))[50], 100);
  });

  test('no expectation at all is no distribution', () => {
    assert.equal(fromFutures(NaN), null);
    assert.equal(fromFutures(undefined), null);
  });
});

describe('reading Polymarket', () => {
  const event = {
    title: 'Fed Decision in September?',
    markets: [
      { groupItemTitle: '50+ bps decrease', outcomePrices: '["0.0015","0.9985"]' },
      { groupItemTitle: '25 bps decrease', outcomePrices: '["0.0035","0.9965"]' },
      { groupItemTitle: 'No change', outcomePrices: '["0.495","0.505"]' },
      { groupItemTitle: '25 bps increase', outcomePrices: '["0.495","0.505"]' },
      { groupItemTitle: '50+ bps increase', outcomePrices: '["0.0065","0.9935"]' },
    ],
  };

  test('all five legs are kept apart, including the tails', () => {
    // The tails are the point of not collapsing early: 0.6% on a fifty is a
    // different market from 0% on one.
    assert.deepEqual(pct(fromPolymarket([event], '2026-09-16')), {
      '-50': 0.1, '-25': 0.3, 0: 49.4, 25: 49.4, 50: 0.6,
    });
  });

  test('the meeting month has to match, so October is not read as September', () => {
    assert.equal(fromPolymarket([event], '2026-10-28'), null);
  });

  test('a half-quoted book is refused rather than half-counted', () => {
    const thin = { ...event, markets: event.markets.slice(0, 2) };
    assert.equal(fromPolymarket([thin], '2026-09-16'), null);
  });

  test('nothing, or something that is not the Fed, is null', () => {
    assert.equal(fromPolymarket([], '2026-09-16'), null);
    assert.equal(fromPolymarket([{ title: 'Super Bowl winner' }], '2026-09-16'), null);
  });
});

describe('reading Kalshi', () => {
  /** Cumulative "Above X%" rungs, quoted two-sided. */
  const rung = (strike, mid, width = 0.01) => ({
    floor_strike: strike,
    yes_bid_dollars: String(mid - width / 2),
    yes_ask_dollars: String(mid + width / 2),
  });
  const ladder = [
    rung(4.25, 0.005), rung(4, 0.015), rung(3.75, 0.515), rung(3.5, 0.995), rung(3.25, 0.995),
  ];

  test('the ladder is differenced into the same five outcomes', () => {
    assert.deepEqual(pct(fromKalshi(ladder, 3.63)), {
      '-50': 0.5, '-25': 0, 0: 48, 25: 50, 50: 1.5,
    });
  });

  test('a rung quoted too wide is not used as a price', () => {
    // A mid from a two-cent market is a number; from a sixty-cent market it is
    // a guess wearing one, and it would move the whole pool.
    const wide = ladder.map((r) => (Number(r.floor_strike) === 3.75 ? rung(3.75, 0.515, 0.6) : r));
    assert.equal(fromKalshi(wide, 3.63), null);
  });

  test('the rungs it needs are the ones around the range today', () => {
    // At 4.33 the relevant rungs are 4.50 and 4.25, and 4.50 is not quoted.
    assert.equal(fromKalshi(ladder, 4.33), null);
  });

  test('an unusable ladder or a missing rate is null, not a guess', () => {
    assert.equal(fromKalshi([], 3.63), null);
    assert.equal(fromKalshi(ladder, 0), null);
    assert.equal(fromKalshi(null, 3.63), null);
  });
});

describe('pooling them', () => {
  const futures = { dist: fromFutures(14.57) };
  const poly = { dist: { '-50': 0.001, '-25': 0.003, 0: 0.494, 25: 0.494, 50: 0.006 } };
  const kalshi = { dist: { '-50': 0.005, '-25': 0, 0: 0.48, 25: 0.5, 50: 0.015 } };

  /** The same three, named — which is what the endpoint actually passes. */
  const named = [
    { id: 'futures', dist: futures.dist },
    { id: 'polymarket', dist: poly.dist },
    { id: 'kalshi', dist: kalshi.dist },
  ];

  test('the real three, pooled in two blocks', () => {
    assert.deepEqual(pct(pool(named)), {
      '-50': 0.2, '-25': 0.1, 0: 46.6, 25: 52.3, 50: 0.7,
    });
  });

  test('Polymarket and Kalshi share one vote, not two', () => {
    /**
     * They correlate at 0.983 — one opinion quoted twice. A flat three-way mean
     * hands it 67% of the answer by accident, so they are averaged together
     * first and the pair takes 70% on purpose.
     *
     * The test: adding Kalshi to a pool that already has Polymarket must not
     * shift the answer nearly as much as adding the futures would.
     */
    const withKalshi = pool([named[0], named[1], named[2]])[25];
    const withoutKalshi = pool([named[0], named[1]])[25];
    const futuresOnly = pool([named[0]])[25];
    assert.ok(
      Math.abs(withKalshi - withoutKalshi) < Math.abs(withKalshi - futuresOnly) / 4,
      'a second prediction market moved the pool like an independent source',
    );
  });

  test('the futures are held to 30%, whatever their depth', () => {
    // Measured, not chosen: minimum-variance weights over thirty days put 29%
    // on them, and they were both the most biased and the noisiest source.
    const pooled = pool(named);
    const marketsOnly = pool([named[1], named[2]])[25];
    const share = (pooled[25] - marketsOnly) / (futures.dist[25] - marketsOnly);
    assert.ok(Math.abs(share - 0.3) < 0.01, `futures carried ${(share * 100).toFixed(1)}%`);
  });

  test('either block alone carries the whole answer', () => {
    assert.deepEqual(pct(pool([named[0]])), pct(futures.dist));
    const marketsOnly = pool([named[1], named[2]]);
    assert.ok(Math.abs(marketsOnly[25] - 0.497) < 0.005, `got ${marketsOnly[25]}`);
  });

  test('unnamed sources still fall back to a plain mean', () => {
    // Every caller that passes bare distributions, tests included.
    assert.deepEqual(pct(pool([futures, poly, kalshi])), {
      '-50': 0.2, '-25': 0.1, 0: 46.4, 25: 52.6, 50: 0.7,
    });
  });

  test('it is not extremized — the pool sits between its members', () => {
    // The decision worth guarding. Extremizing would push the leading outcome
    // above every source that fed it, which is only defensible when forecasters
    // hold independent information. These three read each other.
    const out = pool([futures, poly, kalshi]);
    const members = [futures, poly, kalshi].map((s) => s.dist[25]);
    assert.ok(
      out[25] <= Math.max(...members) && out[25] >= Math.min(...members),
      `pooled ${out[25]} escaped the range of its sources`,
    );
  });

  test('two agreeing outvote one that does not', () => {
    const out = pool([futures, poly, kalshi]);
    assert.ok(Math.abs(out[25] - 0.494) < Math.abs(out[25] - 0.583));
  });

  test('the futures alone reproduce what the panel showed before', () => {
    const b = buckets(pool([futures]));
    assert.equal(b.decrease, 0);
    assert.ok(Math.abs(b.hold - 0.417) < 0.001, `hold ${b.hold}`);
    assert.ok(Math.abs(b.increase - 0.583) < 0.001, `increase ${b.increase}`);
  });

  test('a source that failed simply is not in it', () => {
    assert.deepEqual(pct(pool([futures, { dist: null }])), pct(futures.dist));
    assert.equal(pool([]), null);
    assert.equal(pool(null), null);
  });

  test('the pool is still a distribution', () => {
    assert.ok(Math.abs(sums(pool([futures, poly, kalshi])) - 1) < 1e-12);
  });
});

describe('what the panel reads off it', () => {
  const sources = [
    { dist: fromFutures(14.57) },
    { dist: { '-50': 0.001, '-25': 0.003, 0: 0.494, 25: 0.494, 50: 0.006 } },
    { dist: { '-50': 0.005, '-25': 0, 0: 0.48, 25: 0.5, 50: 0.015 } },
  ];
  const pooled = pool(sources);

  test('the three bars are summed from the five outcomes', () => {
    const b = buckets(pooled);
    assert.ok(Math.abs(b.decrease - 0.003) < 0.001);
    assert.ok(Math.abs(b.hold - 0.464) < 0.001);
    assert.ok(Math.abs(b.increase - 0.533) < 0.001);
    assert.ok(Math.abs(b.decrease + b.hold + b.increase - 1) < 1e-12);
  });

  test('the likeliest single outcome is named, not just the direction', () => {
    // "A hike" and "a quarter-point hike" are different claims.
    const m = mode(pooled);
    assert.equal(m.bps, 25);
    assert.ok(Math.abs(m.probability - 0.526) < 0.001);
  });

  test('the spread is measured on the outcome they collectively lead with', () => {
    // 58.3% against a normalised 49.5%: the gap the panel calls out.
    assert.equal(spread(sources, pooled), 8.8);
    assert.equal(spread([sources[0]]), 0, 'one source cannot disagree with itself');
  });

  test('nothing pooled is nothing read', () => {
    assert.equal(buckets(null), null);
    assert.equal(mode(null), null);
  });
});

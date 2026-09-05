/**
 * The odds on the Fed, read from more than one market.
 *
 * Three venues price this and on 5 September 2026 they did not agree: the fed
 * funds futures implied a 58% chance of a hike while Polymarket said 50% and
 * Kalshi 51% — the two prediction markets agreeing with each other and not with
 * the futures, which is the direction the documented term premium in futures
 * would predict.
 *
 * So the tests are about not losing that. A blend must never quietly become the
 * only thing on offer, an unnormalised book must not out-vote a tight one, and
 * a source that fails must cost its own vote and nothing else.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalise, currentUpper, fromPolymarket, fromKalshi, blend, spread,
} from '../api/_lib/fedsources.js';

const pct = (o) => Object.fromEntries(
  Object.entries(o).map(([k, v]) => [k, +(v * 100).toFixed(1)]),
);

describe('making a book add up', () => {
  test('a book quoting over 100 is scaled, not trusted', () => {
    // Polymarket's five legs came to 100.15: each carries its own spread.
    const out = normalise({ decrease: 0.005, hold: 0.495, increase: 0.5015 });
    const total = out.decrease + out.hold + out.increase;
    assert.ok(Math.abs(total - 1) < 1e-12, `sums to ${total}`);
  });

  test('a book of nothing is null rather than three zeroes', () => {
    assert.equal(normalise({ decrease: 0, hold: 0, increase: 0 }), null);
    assert.equal(normalise(null), null);
  });
});

describe('where the target range sits', () => {
  test('the effective rate is rounded up to the top of its quarter', () => {
    // 3.63 sits inside 3.50–3.75, so a hike is anything above 3.75.
    assert.equal(currentUpper(3.63), 3.75);
    assert.equal(currentUpper(4.33), 4.5);
    assert.equal(currentUpper(3.75), 3.75, 'exactly on the top stays there');
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

  test('five separate binaries fold into the three the panel shows', () => {
    const odds = fromPolymarket([event], '2026-09-16');
    assert.deepEqual(pct(odds), { decrease: 0.5, hold: 49.4, increase: 50.1 });
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
  /** The real ladder: cumulative "Above X%" thresholds. */
  const rung = (strike, mid) => ({
    floor_strike: strike,
    yes_bid_dollars: String(mid - 0.005),
    yes_ask_dollars: String(mid + 0.005),
  });
  const ladder = [
    rung(4.25, 0.005), rung(4, 0.015), rung(3.75, 0.515), rung(3.5, 0.995), rung(3.25, 0.995),
  ];

  test('the ladder is differenced into cut, hold and raise', () => {
    // Above 3.75 is a hike; failing to clear 3.50 is a cut; the rest is a hold.
    assert.deepEqual(pct(fromKalshi(ladder, 3.63)), { decrease: 0.5, hold: 48, increase: 51.5 });
  });

  test('the rungs it needs are the ones around today\'s range', () => {
    // At 4.33 the relevant rungs are 4.50 and 4.25, and 4.50 is not quoted.
    assert.equal(fromKalshi(ladder, 4.33), null);
  });

  test('an unusable ladder or a missing rate is null, not a guess', () => {
    assert.equal(fromKalshi([], 3.63), null);
    assert.equal(fromKalshi(ladder, 0), null);
    assert.equal(fromKalshi(null, 3.63), null);
  });
});

describe('blending them', () => {
  const futures = { id: 'futures', odds: { decrease: 0, hold: 0.417, increase: 0.583 } };
  const poly = { id: 'polymarket', odds: { decrease: 0.005, hold: 0.494, increase: 0.501 } };
  const kalshi = { id: 'kalshi', odds: { decrease: 0.005, hold: 0.48, increase: 0.515 } };

  test('the real three, blended', () => {
    assert.deepEqual(pct(blend([futures, poly, kalshi])), {
      decrease: 0.3, hold: 46.4, increase: 53.3,
    });
  });

  test('two agreeing outvote one that does not', () => {
    // The point of reading three. The blend must land nearer the pair than the
    // outlier, because the outlier is the source with a known lean.
    const out = blend([futures, poly, kalshi]);
    assert.ok(Math.abs(out.increase - 0.505) < Math.abs(out.increase - 0.583));
  });

  test('the futures alone reproduce exactly what the panel showed before', () => {
    assert.deepEqual(pct(blend([futures])), { decrease: 0, hold: 41.7, increase: 58.3 });
  });

  test('a source that failed simply is not in it', () => {
    const partial = blend([futures, { id: 'polymarket', odds: null }]);
    assert.deepEqual(pct(partial), { decrease: 0, hold: 41.7, increase: 58.3 });
    assert.equal(blend([]), null);
    assert.equal(blend(null), null);
  });

  test('the spread is the widest gap on any outcome', () => {
    // 58.3 against 50.1 on a raise: eight points, and worth saying out loud.
    assert.equal(spread([futures, poly, kalshi]), 8.2);
    assert.equal(spread([futures]), 0, 'one source cannot disagree with itself');
  });
});

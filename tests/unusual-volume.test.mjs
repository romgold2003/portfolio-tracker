/**
 * How unusual today's volume is, coin by coin.
 *
 * The three things that make this different from "percent above average" are
 * each a correction for something measured on real data, and each is pinned
 * here because each would be invisible if it silently stopped working:
 *
 *   the baseline is the median, because the mean sits above a typical day
 *   the score is on the logarithm, because a plain one is not comparable
 *   days are compared with their own kind, because Monday is twice a Saturday
 *
 * And the tiers are graded on the score rather than the multiple, because four
 * times the usual volume means different things on different coins. Measured
 * live while this was written: DYDX at 4.53x scored 1.91 while ATOM at 3.82x
 * scored 2.02, because DYDX's volume swings more. Grading on the multiple would
 * have called the less remarkable day the more remarkable one.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  baselineFor, unusualness, tierOf, isWeekend, median, TIERS, LOOKBACK, rankByTurnover, UNIVERSE_SIZE,
} from '../src/services/unusualVolume.js';
import { pushedBy } from '../src/ui/views/unusualVolume.js';

/** A run of days ending on a Friday, so weekdays and weekends are both present. */
const bars = (volumes, from = Date.UTC(2026, 0, 5)) => volumes.map((volume, i) => ({
  at: from + i * 86_400_000,
  volume,
}));

describe('a normal day, and what it is measured against', () => {
  test('the baseline is the median, not the mean', () => {
    // Nineteen quiet days and one enormous one: the mean is dragged far above
    // where the days actually sit, and the median is not.
    const volumes = [...Array(19).fill(100), 10_000];
    const weekdays = bars(volumes).filter((b) => !isWeekend(b.at));
    const baseline = baselineFor(weekdays, false);
    assert.equal(baseline.median, 100, 'the mean would be about 595');
  });

  test('so an ordinary day reads about one', () => {
    const weekdays = bars(Array.from({ length: 30 }, (_, i) => 100 + (i % 5))).filter((b) => !isWeekend(b.at));
    const { rvol } = unusualness(102, baselineFor(weekdays, false));
    assert.ok(Math.abs(rvol - 1) < 0.05, `${rvol}`);
  });

  test('only the last twenty of its own kind are used', () => {
    const many = bars(Array.from({ length: 200 }, () => 100)).filter((b) => !isWeekend(b.at));
    assert.equal(baselineFor(many, false).days, LOOKBACK);
  });

  test('too little history is no answer, which is not the same as normal', () => {
    const few = bars([100, 100, 100]).filter((b) => !isWeekend(b.at));
    assert.equal(baselineFor(few, false), null);
    assert.equal(unusualness(500, null), null);
  });

  test('a day with no volume is not a baseline', () => {
    const zeros = bars(Array(30).fill(0)).filter((b) => !isWeekend(b.at));
    assert.equal(baselineFor(zeros, false), null);
  });
});

describe('weekdays are compared with weekdays', () => {
  test('a quiet weekend is not a collapse, and a busy Monday is not a spike', () => {
    // Weekdays run at 1000, weekends at 500 — the real shape, roughly.
    const all = bars(Array.from({ length: 60 }, (_, i) => 0)).map((b) => ({
      ...b, volume: isWeekend(b.at) ? 500 : 1000,
    }));

    // Saturday at its own normal reads 1.0, not 0.5.
    const weekend = unusualness(500, baselineFor(all, true));
    assert.ok(Math.abs(weekend.rvol - 1) < 1e-9, `${weekend.rvol}`);

    // Monday at its own normal reads 1.0, not 1.33.
    const weekday = unusualness(1000, baselineFor(all, false));
    assert.ok(Math.abs(weekday.rvol - 1) < 1e-9, `${weekday.rvol}`);
  });

  test('a genuine weekend spike is still seen, at weekend scale', () => {
    const all = bars(Array.from({ length: 60 }, () => 0)).map((b) => ({
      ...b, volume: isWeekend(b.at) ? 500 : 1000,
    }));
    // 1,200 on a Saturday is only 1.2x a weekday, but 2.4x a Saturday.
    const { rvol } = unusualness(1200, baselineFor(all, true));
    assert.ok(Math.abs(rvol - 2.4) < 1e-9, `${rvol}`);
  });

  test('Saturday and Sunday are the weekend, and nothing else is', () => {
    assert.equal(isWeekend(Date.UTC(2026, 0, 3)), true, 'Saturday');
    assert.equal(isWeekend(Date.UTC(2026, 0, 4)), true, 'Sunday');
    for (let d = 5; d <= 9; d++) assert.equal(isWeekend(Date.UTC(2026, 0, d)), false);
  });
});

describe('the score, which is what the list is ranked by', () => {
  test('is taken on the logarithm, so a steady coin and a wild one compare', () => {
    const steady = bars(Array.from({ length: 40 }, (_, i) => 1000 + (i % 3) * 10)).filter((b) => !isWeekend(b.at));
    const wild = bars(Array.from({ length: 40 }, (_, i) => 1000 * (1 + (i % 7)))).filter((b) => !isWeekend(b.at));

    // The same multiple is far more surprising on the coin that never varies.
    const a = unusualness(3000, baselineFor(steady, false));
    const b = unusualness(3000, baselineFor(wild, false));
    assert.ok(a.z > b.z, `steady ${a.z} should outscore wild ${b.z} at the same volume`);
  });

  test('a coin whose volume never moves has no score, rather than an infinite one', () => {
    const flat = bars(Array(40).fill(1000)).filter((b) => !isWeekend(b.at));
    const m = unusualness(2000, baselineFor(flat, false));
    assert.equal(m.z, null);
    assert.equal(m.rvol, 2);
  });

  test('nonsense in is nothing out', () => {
    const ok = baselineFor(bars(Array(40).fill(1000)).filter((b) => !isWeekend(b.at)), false);
    for (const bad of [0, -5, NaN, null, undefined]) assert.equal(unusualness(bad, ok), null);
  });
});

describe('the tiers', () => {
  test('grade the score, not the multiple', () => {
    // The live pair that made the point: the bigger multiple scored lower.
    assert.equal(tierOf(2.02).id, 'unusual', 'ATOM at 3.82x');
    assert.equal(tierOf(1.91).id, 'busy', 'DYDX at 4.53x');
  });

  test('sit where the distribution thins, measured on 10,200 coin-days', () => {
    assert.equal(tierOf(3.1).id, 'extreme');   // 98th percentile
    assert.equal(tierOf(2.4).id, 'unusual');   // 95th
    assert.equal(tierOf(1.6).id, 'busy');      // 90th
    assert.equal(tierOf(0.2).id, 'normal');
    assert.equal(tierOf(-2).id, 'quiet');
  });

  test('every tier says how often it happens, so the word can be checked', () => {
    for (const t of TIERS) assert.ok(t.note && t.label, `${t.id} is unlabelled`);
  });

  test('an unscored coin falls to normal rather than to the top of the list', () => {
    assert.equal(tierOf(null).id, 'normal');
    assert.equal(tierOf(undefined).id, 'normal');
  });
});

describe('the median itself', () => {
  test('is the middle of an odd list and the average of the middle two of an even one', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([]), null);
  });
});

/**
 * The coins it watches, which are chosen by the exchange rather than listed.
 *
 * This began as the app's own hardcoded ticker list and that was wrong the way
 * a hardcoded list is always wrong. Of its seventy-five names, forty-three were
 * not in the live top sixty and ten no longer traded at all. Worse for a panel
 * whose job is to notice the unexpected: twenty-eight of the live top sixty had
 * never been on the list, and one of them was up 58% that afternoon on ninety
 * million of turnover.
 */
describe('the coins it watches', () => {
  const t = (symbol, quoteVolume, count = 1000) => ({ symbol, quoteVolume: String(quoteVolume), count });

  test('are ranked by turnover, biggest first', () => {
    const ranked = rankByTurnover([t('AAAUSDT', 5e6), t('BBBUSDT', 9e9), t('CCCUSDT', 3e7)]);
    assert.deepEqual(ranked.map((r) => r.ticker), ['BBB', 'CCC', 'AAA']);
    assert.equal(ranked[0].symbol, 'BBBUSDT');
  });

  test('exclude stablecoins, because dollars against dollars is not conviction', () => {
    const ranked = rankByTurnover([t('USDCUSDT', 9e9), t('FDUSDUSDT', 8e9), t('RLUSDUSDT', 7e9), t('BTCUSDT', 1e7)]);
    assert.deepEqual(ranked.map((r) => r.ticker), ['BTC']);
  });

  test('exclude leveraged tokens, whose volume is an echo of the coin', () => {
    const ranked = rankByTurnover([t('BTCUPUSDT', 9e9), t('ETHDOWNUSDT', 8e9), t('ETHBULLUSDT', 8e9), t('SOLUSDT', 1e7)]);
    assert.deepEqual(ranked.map((r) => r.ticker), ['SOL']);
  });

  test('exclude anything too thin for its own median to mean much', () => {
    const ranked = rankByTurnover([t('THINUSDT', 1e5), t('REALUSDT', 5e7)]);
    assert.deepEqual(ranked.map((r) => r.ticker), ['REAL']);
  });

  test('and anything not quoted in dollars, or not trading at all', () => {
    const ranked = rankByTurnover([t('ETHBTC', 9e9), t('DEADUSDT', 9e9, 0), t('LIVEUSDT', 1e7)]);
    assert.deepEqual(ranked.map((r) => r.ticker), ['LIVE']);
  });

  test('are capped, so the panel is a shortlist rather than a board', () => {
    const board = Array.from({ length: 200 }, (_, i) => t(`C${i}USDT`, 1e9 - i));
    assert.equal(rankByTurnover(board).length, UNIVERSE_SIZE);
    assert.equal(rankByTurnover(board, 5).length, 5);
  });

  test('an empty or broken board is an empty list, not a crash', () => {
    assert.deepEqual(rankByTurnover([]), []);
    assert.deepEqual(rankByTurnover(null), []);
    assert.deepEqual(rankByTurnover([{ nonsense: true }, null]), []);
  });
});

/**
 * Who crossed the spread.
 *
 * Every trade has a buyer and a seller, so "buying volume" is not a thing that
 * exists; what can be measured is which side was in a hurry. It sits close to
 * even most of the time even under a large move — QNT rose 59% on 52% buyers —
 * so the wording refuses to call anything near half a verdict.
 */
describe('which side was pushing', () => {
  test('commits only past a few points either side of even', () => {
    assert.equal(pushedBy(0.60).text, '60% buyers');
    assert.equal(pushedBy(0.54).text, '54% buyers');
    assert.equal(pushedBy(0.40).text, '60% sellers');
    assert.equal(pushedBy(0.46).text, '54% sellers');
  });

  test('and says so plainly when there is nothing in it', () => {
    for (const share of [0.47, 0.5, 0.52, 0.53]) {
      assert.equal(pushedBy(share).text, 'even', `${share}`);
    }
  });

  test('a coin it could not measure shows a dash, not a balanced market', () => {
    assert.equal(pushedBy(null).text, '—');
    assert.equal(pushedBy(undefined).text, '—');
  });

  test('buyers read green and sellers red, and even reads as neither', () => {
    assert.match(pushedBy(0.7).tone, /green/);
    assert.match(pushedBy(0.3).tone, /red/);
    assert.match(pushedBy(0.5).tone, /text3/);
  });
});

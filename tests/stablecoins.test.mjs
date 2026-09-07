/**
 * Stablecoin dominance — how much of the market is sitting in dollars.
 *
 * The reading: stablecoins are money that entered crypto and has not been
 * spent. A high share means buying power is waiting; a low share means it has
 * already been deployed. The number is meaningless without the year behind it,
 * so most of this file is about the ranking rather than the ratio.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { useDriver } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import {
  positionOf, combine, store, read, resetTableCache, dayOf, STANCE_TONE,
  fetchStableHistory, fetchTotalHistory,
} from '../api/_lib/stablecoins.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 7);

beforeEach(() => {
  useDriver(sqliteDriver());
  resetTableCache();
});

const history = (values) => values.map((dominance, i) => ({ day: `d${i}`, dominance }));

describe('where today sits in its own year', () => {
  const year = history(Array.from({ length: 300 }, (_, i) => 8 + (i % 60) / 10));

  test('the highest reading it has ever had ranks at the top', () => {
    const p = positionOf(99, year);
    assert.equal(p.percentile, 100);
    assert.equal(p.stance, 'Bullish');
    assert.match(p.reads, /sidelines/i);
  });

  test('the lowest ranks at the bottom, and reads as money already spent', () => {
    const p = positionOf(0, year);
    assert.equal(p.percentile, 0);
    assert.equal(p.stance, 'Bearish');
    assert.match(p.reads, /deployed/i);
  });

  test('the middle is neither, and says so', () => {
    // Evenly spread, with today in the middle of it.
    const p = positionOf(50, history(Array.from({ length: 100 }, (_, i) => i)));
    assert.equal(p.percentile, 50);
    assert.equal(p.stance, 'Neutral');
    assert.match(p.reads, /neither/i);
  });

  test('the range and the median come back with it', () => {
    const p = positionOf(10, history([5, 7, 9, 11, 13, ...Array(60).fill(10)]));
    assert.equal(p.low, 5);
    assert.equal(p.high, 13);
    assert.equal(p.days, 65);
  });

  test('too little history is no percentile at all, never a made-up one', () => {
    // A percentile drawn from six days is a confident-looking accident.
    assert.equal(positionOf(11, history([10, 11, 12, 13, 14, 15])), null);
    assert.equal(positionOf(11, []), null);
    assert.equal(positionOf(NaN, history(Array(100).fill(10))), null);
  });

  test('every stance has a tone, and neutral earns none', () => {
    for (const s of ['Bullish', 'Bearish', 'Neutral']) {
      assert.equal(typeof STANCE_TONE[s], 'string');
    }
    assert.equal(STANCE_TONE.Neutral, '');
  });
});

describe('joining an exact numerator to a rebuilt denominator', () => {
  const stable = [
    { day: '2026-09-05', stableUsd: 300e9 },
    { day: '2026-09-06', stableUsd: 310e9 },
    { day: '2026-09-07', stableUsd: 312e9 },
  ];
  const total = [
    { day: '2026-09-05', totalUsd: 2.5e12 },
    { day: '2026-09-06', totalUsd: 2.6e12 },
    { day: '2026-09-07', totalUsd: 2.62e12 },
  ];

  test('the rebuilt total is scaled to the true one, so the level is right today', () => {
    // The top thirty are 97.8% of the market. Left unscaled the dominance would
    // read a few tenths high, permanently, for no reason anybody could see.
    const { rows, scale } = combine({ stable, total, trueTotalNow: 2.681e12 });
    assert.ok(Math.abs(scale - 2.681 / 2.62) < 1e-9);
    const last = rows[rows.length - 1];
    assert.ok(Math.abs(last.totalUsd - 2.681e12) < 1);
    assert.ok(Math.abs((last.stableUsd / last.totalUsd) * 100 - 11.64) < 0.05);
  });

  test('the scale carries backwards, so the shape is unchanged', () => {
    const { rows } = combine({ stable, total, trueTotalNow: 2.681e12 });
    const plain = combine({ stable, total, trueTotalNow: null }).rows;
    const ratio = (r) => r.stableUsd / r.totalUsd;
    // Every day moves by the same factor: a rescale, not a reshape.
    const factors = rows.map((r, i) => ratio(r) / ratio(plain[i]));
    for (const f of factors) assert.ok(Math.abs(f - factors[0]) < 1e-9);
  });

  test('a day the rebuilt total is missing is dropped, not guessed at', () => {
    const { rows } = combine({ stable, total: total.slice(1), trueTotalNow: null });
    assert.deepEqual(rows.map((r) => r.day), ['2026-09-06', '2026-09-07']);
  });

  test('with no true total it still works, unscaled', () => {
    const { rows, scale } = combine({ stable, total, trueTotalNow: null });
    assert.equal(scale, 1);
    assert.equal(rows.length, 3);
  });
});

describe('the stored series, read back', () => {
  const days = (n) => Array.from({ length: n }, (_, i) => ({
    day: dayOf(NOW - (n - 1 - i) * DAY),
    stableUsd: 300e9,
    // A total that falls means dominance rises: the same dollars, a smaller market.
    totalUsd: 3e12 - i * 1e9,
  }));

  test('an empty table is null, never a dominance of zero', async () => {
    // A card drawing 0% is saying something false about the market rather than
    // admitting it has not been told anything yet.
    assert.equal(await read({ now: NOW }), null);
  });

  test('the newest day is the reading, and the ratio is the ratio', async () => {
    await store([{ day: '2026-09-06', stableUsd: 300e9, totalUsd: 3e12 },
      { day: '2026-09-07', stableUsd: 312e9, totalUsd: 2.681e12 }], { now: NOW });
    const r = await read({ now: NOW });
    assert.equal(r.day, '2026-09-07');
    assert.ok(Math.abs(r.dominance - 11.637) < 0.01);
    assert.equal(r.stableUsd, 312e9);
  });

  test('a year of days gives a percentile; a fortnight does not', async () => {
    await store(days(14), { now: NOW });
    assert.equal((await read({ now: NOW })).position, null);

    resetTableCache();
    await store(days(200), { now: NOW });
    const r = await read({ now: NOW });
    assert.ok(r.position, 'two hundred days should be enough to rank against');
    assert.equal(r.position.percentile, 100, 'a rising series peaks today');
  });

  test('it says which way the last month went', async () => {
    await store(days(120), { now: NOW });
    const r = await read({ now: NOW });
    assert.ok(r.changed30d > 0, 'the total shrank, so dominance rose');
  });

  test('the sparkline is thinned rather than sent whole', async () => {
    await store(days(365), { now: NOW });
    const r = await read({ now: NOW });
    assert.ok(r.spark.length <= 61, `got ${r.spark.length} points`);
    assert.ok(r.spark.every(Number.isFinite));
  });

  test('a day written twice is replaced, not doubled', async () => {
    await store([{ day: '2026-09-07', stableUsd: 1e9, totalUsd: 10e9 }], { now: NOW });
    await store([{ day: '2026-09-07', stableUsd: 2e9, totalUsd: 10e9 }], { now: NOW });
    const r = await read({ now: NOW });
    assert.equal(r.stableUsd, 2e9);
  });

  test('rows that make no sense never reach the table', async () => {
    const written = await store([
      { day: 'not-a-day', stableUsd: 1e9, totalUsd: 10e9 },
      { day: '2026-09-07', stableUsd: 0, totalUsd: 10e9 },
      { day: '2026-09-07', stableUsd: 1e9, totalUsd: 0 },
    ], { now: NOW });
    assert.equal(written, 0);
  });
});

describe('reading the published stablecoin history', () => {
  test('each day is the sum of every stablecoin circulating that day', async () => {
    const fetcher = async () => ({
      ok: true,
      status: 200,
      json: async () => ([
        { date: '1788000000', totalCirculatingUSD: { peggedUSD: 300e9, peggedEUR: 2e9 } },
        { date: '1788086400', totalCirculatingUSD: { peggedUSD: 310e9 } },
        { date: '1788172800', totalCirculatingUSD: {} },
      ]),
    });
    const out = await fetchStableHistory({ fetcher });
    assert.equal(out.length, 2, 'a day holding nothing is not a day');
    assert.equal(out[0].stableUsd, 302e9);
    assert.match(out[0].day, /^\d{4}-\d{2}-\d{2}$/);
  });

  test('a bad answer throws rather than returning an empty market', async () => {
    await assert.rejects(() => fetchStableHistory({
      fetcher: async () => ({ ok: false, status: 502 }),
    }), /502/);
  });
});

describe('being rate limited, which is the normal case', () => {
  // CoinGecko's free tier allows a handful of calls a minute per address and
  // this asks for thirty in a row from a shared CI runner. Treating 429 as a
  // failure made the collector answer "0 of 30 coins" and give up.
  const answering = (statuses) => {
    let i = 0;
    return async () => {
      const status = statuses[Math.min(i++, statuses.length - 1)];
      return {
        ok: status === 200,
        status,
        headers: { get: () => null },
        json: async () => ([{ date: '1788000000', totalCirculatingUSD: { peggedUSD: 1e9 } }]),
      };
    };
  };

  test('a 429 is waited out rather than given up on', async () => {
    const waits = [];
    const out = await fetchStableHistory({
      fetcher: answering([429, 429, 200]),
      sleep: async (ms) => { waits.push(ms); },
    });
    assert.equal(out.length, 1);
    assert.equal(waits.length, 2, 'it should have waited twice');
    assert.ok(waits[1] > waits[0], 'and waited longer the second time');
  });

  test('Retry-After is obeyed when the server sends one', async () => {
    const waits = [];
    let first = true;
    await fetchStableHistory({
      fetcher: async () => {
        const limited = first; first = false;
        return {
          ok: !limited,
          status: limited ? 429 : 200,
          headers: { get: (h) => (h === 'retry-after' && limited ? '7' : null) },
          json: async () => ([{ date: '1788000000', totalCirculatingUSD: { peggedUSD: 1e9 } }]),
        };
      },
      sleep: async (ms) => { waits.push(ms); },
    });
    assert.deepEqual(waits, [7000]);
  });

  test('it gives up eventually rather than retrying forever', async () => {
    const waits = [];
    await assert.rejects(() => fetchStableHistory({
      fetcher: answering([429]),
      sleep: async (ms) => { waits.push(ms); },
    }), /429/);
    assert.ok(waits.length <= 4, `waited ${waits.length} times`);
  });

  test('a 404 is not retried, because it will not get better', async () => {
    const waits = [];
    await assert.rejects(() => fetchStableHistory({
      fetcher: answering([404]),
      sleep: async (ms) => { waits.push(ms); },
    }), /404/);
    assert.equal(waits.length, 0);
  });
});

describe('rebuilding the total, one value per coin per day', () => {
  // The series carries a daily point for every day and a live one for today,
  // so today arrives twice. Summing every point counted today double for every
  // coin — and since the scale is measured on the newest day, that doubled
  // figure became the calibration and halved the entire history behind it.
  const chartFor = (points) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ market_caps: points }),
  });

  const t = (day, hour = 0) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`);

  test('a day appearing twice in one coin is counted once', async () => {
    let call = 0;
    const fetcher = async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ([{ id: 'bitcoin', symbol: 'btc' }]),
        };
      }
      // A daily point for today, and the live one on top of it.
      return chartFor([[t('2026-09-06'), 1e12], [t('2026-09-07'), 2e12], [t('2026-09-07', 15), 2e12]]);
    };

    const { series } = await fetchTotalHistory({ fetcher, coins: 1, pauseMs: 0 });
    const today = series.find((d) => d.day === '2026-09-07');
    assert.equal(today.totalUsd, 2e12, 'today was counted twice');
    assert.equal(series.length, 2);
  });

  test('two coins on the same day are still added together', async () => {
    let call = 0;
    const fetcher = async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ([{ id: 'a', symbol: 'a' }, { id: 'b', symbol: 'b' }]),
        };
      }
      return chartFor([[t('2026-09-07'), 1e12]]);
    };

    const { series, used } = await fetchTotalHistory({ fetcher, coins: 2, pauseMs: 0 });
    assert.equal(used, 2);
    assert.equal(series[0].totalUsd, 2e12, 'the coins should sum');
  });

  test('the scale lands near one when the sum is honest', async () => {
    // 192% was the symptom. A correct top-20 sum is a little under the true
    // total, so the scale should be slightly above one and never near two.
    const { scale } = combine({
      stable: [{ day: '2026-09-07', stableUsd: 300e9 }],
      total: [{ day: '2026-09-07', totalUsd: 2.57e12 }],
      trueTotalNow: 2.673e12,
    });
    assert.ok(scale > 1 && scale < 1.2, `scale was ${scale}`);
  });
});

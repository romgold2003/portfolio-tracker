/**
 * The netflow graph: the series behind it, and the bucketing in front of it.
 *
 * The sign convention is the thing this file guards hardest. Positive netflow
 * is coins arriving on exchanges, which is the **bearish** direction, and it is
 * drawn above the zero line. It would be easy — and wrong — to flip the
 * arithmetic so that bullish points upward, because upward reads as good. The
 * number stays mathematically correct and the colour carries the meaning.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { useDriver } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import {
  series, store, resetTableCache, noteLive, liveSeries, resetLiveTableCache,
} from '../api/_lib/cexflow.js';
import {
  NETFLOW_FRAMES, netflowFrame, netflowBars, netflowIntraday, netflowSignal, barLabel,
} from '../src/services/cryptoWhales.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 11);
const dayAt = (back) => new Date(NOW - back * DAY).toISOString().slice(0, 10);

beforeEach(() => {
  useDriver(sqliteDriver());
  resetTableCache();
  resetLiveTableCache();
});

describe('the stored series', () => {
  test('sums the exchanges into one market-wide row per day', async () => {
    await store('Binance', [{ day: '2026-09-01', inUsd: 100, outUsd: 40 }], { now: NOW });
    await store('OKX', [{ day: '2026-09-01', inUsd: 25, outUsd: 10 }], { now: NOW });

    const { rows, venues } = await series({ now: NOW });
    assert.deepEqual(rows, [['2026-09-01', 125, 50]]);
    assert.equal(venues, 2, 'the day should know it was built from two exchanges');
  });

  test('comes back oldest first, so a graph can plot it as it stands', async () => {
    await store('Binance', [
      { day: '2026-09-03', inUsd: 3, outUsd: 0 },
      { day: '2026-09-01', inUsd: 1, outUsd: 0 },
      { day: '2026-09-02', inUsd: 2, outUsd: 0 },
    ], { now: NOW });

    const { rows, since, until } = await series({ now: NOW });
    assert.deepEqual(rows.map((r) => r[0]), ['2026-09-01', '2026-09-02', '2026-09-03']);
    assert.equal(since, '2026-09-01');
    assert.equal(until, '2026-09-03');
  });

  test('keeps the two sides apart rather than storing only the net', async () => {
    // A day of two billion each way and a day of nothing have the same net and
    // are completely different facts about the market.
    await store('Binance', [{ day: '2026-09-01', inUsd: 2e9, outUsd: 2e9 }], { now: NOW });
    const { rows } = await series({ now: NOW });
    assert.deepEqual(rows[0], ['2026-09-01', 2e9, 2e9]);
  });

  test('an empty table is an empty series, not a thrown error', async () => {
    const { rows, since } = await series({ now: NOW });
    assert.deepEqual(rows, []);
    assert.equal(since, null);
  });
});

describe('the intraday record', () => {
  test('a reading is kept and comes back', async () => {
    await noteLive({ inUsd: 900, outUsd: 1500, at: NOW }, { now: NOW });
    const rows = await liveSeries({ now: NOW, hours: 24 });
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].slice(1), [900, 1500]);
  });

  test('two readings in the same minute leave one row, the later one', async () => {
    await noteLive({ inUsd: 100, outUsd: 0, at: NOW }, { now: NOW });
    await noteLive({ inUsd: 200, outUsd: 0, at: NOW + 5_000 }, { now: NOW });
    const rows = await liveSeries({ now: NOW, hours: 24 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0][1], 200);
  });

  test('readings older than the window are dropped as they age out', async () => {
    await noteLive({ inUsd: 1, outUsd: 0, at: NOW - 3 * DAY }, { now: NOW - 3 * DAY });
    await noteLive({ inUsd: 2, outUsd: 0, at: NOW }, { now: NOW });
    const rows = await liveSeries({ now: NOW, hours: 48 });
    assert.equal(rows.length, 1, 'the three-day-old reading should have been pruned');
  });

  test('nonsense is refused rather than stored as zero', async () => {
    assert.equal(await noteLive({ inUsd: NaN, outUsd: 5 }, { now: NOW }), false);
    assert.equal(await noteLive(null, { now: NOW }), false);
    assert.deepEqual(await liveSeries({ now: NOW }), []);
  });
});

describe('the sign convention, which must not be flipped for the picture', () => {
  test('more in than out is Bearish and is a positive number', () => {
    assert.equal(netflowSignal(600e6, 4.2e9), 'Bearish');
  });

  test('more out than in is Bullish and is a negative number', () => {
    assert.equal(netflowSignal(-600e6, 4.2e9), 'Bullish');
  });

  test('a net that is noise beside the gross is Neutral', () => {
    // Fifty billion each way and a hundred million left over is a coin flip,
    // not a market call.
    assert.equal(netflowSignal(100e6, 100e9), 'Neutral');
  });

  test('nothing moving at all is Neutral, not Bullish', () => {
    assert.equal(netflowSignal(0, 0), 'Neutral');
  });

  test('a bullish bar keeps its negative value, so it draws below zero', () => {
    const bars = netflowBars([[dayAt(1), 1.8e9, 2.4e9]], '7d', { now: NOW });
    assert.equal(bars[0].netUsd, -600e6);
    assert.equal(bars[0].signal, 'Bullish');
  });
});

describe('bucketing, so a year is not three hundred and sixty five slivers', () => {
  const year = [];
  // Through today inclusive: the window boundary is exclusive, the same rule
  // periods() uses, so 7D means the seven days after the cutoff day.
  for (let i = 400; i >= 0; i -= 1) year.push([dayAt(i), 1e9, 0.9e9]);

  test('a week is drawn a day at a time', () => {
    const bars = netflowBars(year, '7d', { now: NOW });
    assert.equal(bars.length, 7);
    assert.ok(bars.every((b) => b.grain === 'day'));
  });

  test('a year is drawn a week at a time, not a day at a time', () => {
    const bars = netflowBars(year, '1y', { now: NOW });
    assert.ok(bars.length >= 52 && bars.length <= 54, `got ${bars.length} bars`);
    assert.ok(bars.every((b) => b.grain === 'week'));
  });

  test('all of it is drawn a month at a time', () => {
    const bars = netflowBars(year, 'all', { now: NOW });
    assert.ok(bars.length <= 15, `got ${bars.length} bars for thirteen months`);
    assert.ok(bars.every((b) => b.grain === 'month'));
  });

  test('a bucket sums both sides, and takes the net from the sums', () => {
    // Not the average of the daily nets: a week of huge churn that nets to
    // nothing has to still show the churn.
    const week = [
      [dayAt(3), 1e9, 0],
      [dayAt(2), 0, 1e9],
      [dayAt(1), 5e8, 5e8],
    ];
    const [bar] = netflowBars(week, '1y', { now: NOW });
    assert.equal(bar.inUsd, 1.5e9);
    assert.equal(bar.outUsd, 1.5e9);
    assert.equal(bar.netUsd, 0);
    assert.equal(bar.signal, 'Neutral');
  });

  test('weekly bars start on the same weekday every time', () => {
    const bars = netflowBars(year, '1y', { now: NOW });
    const weekdays = new Set(bars.map((b) => new Date(`${b.key}T00:00:00Z`).getUTCDay()));
    assert.equal(weekdays.size, 1, 'weeks drifted across weekdays');
  });

  test('the window really is the window', () => {
    const bars = netflowBars(year, '1m', { now: NOW });
    assert.equal(bars.length, 30, 'a month should be thirty daily bars');
    assert.ok(bars[0].key > dayAt(31));
  });

  test('all means all, with no cutoff', () => {
    const bars = netflowBars(year, 'all', { now: NOW });
    const days = bars.reduce((sum, b) => sum + b.days, 0);
    assert.equal(days, year.length);
  });

  test('nothing stored is no bars rather than a thrown error', () => {
    assert.deepEqual(netflowBars([], '1y', { now: NOW }), []);
    assert.deepEqual(netflowBars(null, '1y', { now: NOW }), []);
  });
});

describe('the intraday frame', () => {
  const readings = [];
  for (let h = 26; h >= 0; h -= 1) {
    readings.push([Math.floor((NOW - h * 3600_000) / 1000), 2e9, 2.6e9]);
  }

  test('thins to one point an hour', () => {
    const points = netflowIntraday(readings, { now: NOW, hours: 24 });
    assert.ok(points.length <= 25, `got ${points.length}`);
    assert.ok(points.length >= 24, `got ${points.length}`);
  });

  test('two readings in one hour leave the later one standing for it', () => {
    const at = Math.floor(NOW / 1000);
    const points = netflowIntraday([
      [at - 1800, 1e9, 0],
      [at - 600, 2e9, 0],
    ], { now: NOW, hours: 24 });
    assert.equal(points.length, 1);
    assert.equal(points[0].inUsd, 2e9);
  });

  test('carries the same signal rule as every other frame', () => {
    const points = netflowIntraday(readings, { now: NOW, hours: 24 });
    assert.equal(points[0].netUsd, -600e6);
    assert.equal(points[0].signal, 'Bullish');
  });

  test('no readings yet is an empty frame, not a crash', () => {
    assert.deepEqual(netflowIntraday([], { now: NOW }), []);
    assert.deepEqual(netflowIntraday(undefined, { now: NOW }), []);
  });
});

describe('the frames on offer', () => {
  test('are the ones asked for, in order', () => {
    assert.deepEqual(NETFLOW_FRAMES.map((f) => f.label), ['1D', '7D', '1M', '3M', '1Y', 'All']);
  });

  test('an unknown frame falls back rather than throwing', () => {
    assert.equal(netflowFrame('nonsense').id, '7d');
  });

  test('a bar names the span it covers', () => {
    const [day] = netflowBars([[dayAt(1), 1, 0]], '7d', { now: NOW });
    assert.match(barLabel(day), /Sep/);
    const [month] = netflowBars([[dayAt(1), 1, 0]], 'all', { now: NOW });
    assert.match(barLabel(month), /2026/);
  });
});

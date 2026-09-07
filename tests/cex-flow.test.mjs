/**
 * Exchange flow from published balances.
 *
 * The trap this file exists to guard: **an exchange's balance in dollars moves
 * for two reasons and only one of them is a flow.** Coins arrive or leave, and
 * the coins already there reprice. Binance's published holdings went from
 * $181.5B on 1 January to $170.3B in September; subtracting reads as eleven
 * billion dollars leaving, and it is not — priced at one constant date the
 * quantities held rose. The naive subtraction had the sign backwards.
 *
 * So the tests below check quantities valued at one price, never dollars
 * subtracted from dollars.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { useDriver } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import {
  pricesFrom, flowBetween, dailyFlows, periods, store, resetTableCache,
  startOfYear, dayOf, HISTORY_PERIODS, listExchanges,
} from '../api/_lib/cexflow.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 7);

beforeEach(() => {
  useDriver(sqliteDriver());
  resetTableCache();
});

/** A series of daily snapshots, given as [day, {token: quantity}]. */
const series = (points, prices) => ({
  tokens: points.map(([d, tokens]) => ({ date: Math.floor(Date.parse(d) / 1000), tokens })),
  tokensInUsd: points.map(([d, tokens]) => ({
    date: Math.floor(Date.parse(d) / 1000),
    tokens: Object.fromEntries(Object.entries(tokens).map(([s, q]) => [s, q * (prices[s] ?? 0)])),
  })),
});

describe('pricing, so that repricing is not read as movement', () => {
  test('the price comes from the two series divided', () => {
    const s = series([['2026-09-06', { BTC: 100, ETH: 1000 }]], { BTC: 60_000, ETH: 3_000 });
    const p = pricesFrom(s);
    assert.equal(p.BTC, 60_000);
    assert.equal(p.ETH, 3_000);
  });

  test('a token with no value has no price rather than a price of zero', () => {
    // Pricing an unknown holding at zero would silently delete it from the flow.
    const p = pricesFrom({
      tokens: [{ date: 1, tokens: { FOO: 10, BAR: 5 } }],
      tokensInUsd: [{ date: 1, tokens: { FOO: 100 } }],
    });
    assert.equal(p.FOO, 10);
    assert.ok(!('BAR' in p), 'BAR was given a price it does not have');
  });

  test('a price move with no coins moving is not a flow', () => {
    // The whole point of the file. The same coins, worth half as much.
    const before = { BTC: 100 };
    const after = { BTC: 100 };
    assert.deepEqual(flowBetween(before, after, { BTC: 30_000 }),
      { inUsd: 0, outUsd: 0, netUsd: 0 });
  });
});

describe('which way the coins went', () => {
  const price = { BTC: 60_000, USDT: 1 };

  test('coins arriving is a positive net, which is the bearish direction', () => {
    const f = flowBetween({ BTC: 100 }, { BTC: 110 }, price);
    assert.equal(f.inUsd, 600_000);
    assert.equal(f.outUsd, 0);
    assert.equal(f.netUsd, 600_000);
  });

  test('coins leaving is a negative net, which is the bullish one', () => {
    const f = flowBetween({ BTC: 100 }, { BTC: 90 }, price);
    assert.equal(f.outUsd, 600_000);
    assert.equal(f.netUsd, -600_000);
  });

  test('the two sides are kept apart, because a busy flat week is not a quiet one', () => {
    const f = flowBetween({ BTC: 100, USDT: 5_000_000 }, { BTC: 110, USDT: 4_400_000 }, price);
    assert.equal(f.inUsd, 600_000);
    assert.equal(f.outUsd, 600_000);
    assert.equal(f.netUsd, 0);
    // Net zero, but $1.2M moved. Reporting only the net would call this quiet.
    assert.ok(f.inUsd + f.outUsd > 0);
  });

  test('a token that appears from nothing counts as arriving', () => {
    assert.equal(flowBetween({}, { BTC: 1 }, price).inUsd, 60_000);
  });

  test('a token with no known price is skipped, not counted at zero', () => {
    assert.deepEqual(flowBetween({ MYSTERY: 10 }, { MYSTERY: 900 }, price),
      { inUsd: 0, outUsd: 0, netUsd: 0 });
  });
});

describe('a whole series reduced to days', () => {
  const s = series([
    ['2026-09-01', { BTC: 100 }],
    ['2026-09-02', { BTC: 110 }],
    ['2026-09-03', { BTC: 105 }],
    ['2026-09-04', { BTC: 105 }],
  ], { BTC: 60_000 });

  test('one row per day after the first, since a day needs a day before it', () => {
    const out = dailyFlows(s);
    assert.equal(out.length, 3);
    assert.deepEqual(out.map((r) => r.day), ['2026-09-02', '2026-09-03', '2026-09-04']);
  });

  test('each day is the change from the day before', () => {
    const [up, down, flat] = dailyFlows(s);
    assert.equal(up.netUsd, 600_000);
    assert.equal(down.netUsd, -300_000);
    assert.equal(flat.netUsd, 0);
  });

  test('a series of one day yields nothing rather than throwing', () => {
    assert.deepEqual(dailyFlows(series([['2026-09-01', { BTC: 1 }]], { BTC: 1 })), []);
    assert.deepEqual(dailyFlows({}), []);
  });

  test('the days are capped so a four-year series does not all get stored', () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      [new Date(Date.UTC(2025, 0, 1) + i * DAY).toISOString().slice(0, 10), { BTC: 100 + i }]);
    assert.equal(dailyFlows(series(many, { BTC: 1 }), { days: 30 }).length, 30);
  });
});

describe('the periods, read back from the store', () => {
  const put = async (venue, rows) => store(venue, rows, { now: NOW });
  const on = (daysAgo, netUsd) => ({
    day: new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10),
    inUsd: netUsd > 0 ? netUsd : 0,
    outUsd: netUsd < 0 ? -netUsd : 0,
    netUsd,
  });

  test('an empty store answers with no periods at all, so the card can say so', async () => {
    const { periods: p, since } = await periods({ now: NOW });
    assert.deepEqual(p, []);
    assert.equal(since, null);
  });

  test('a period the record does not reach is null, never zero', async () => {
    // 'Nothing moved' and 'nothing is known' are different facts, and a card
    // that shows the second as the first is lying quietly.
    await store('Binance', [on(1, 4e9)], { now: NOW });
    const { periods: p } = await periods({ now: NOW });
    assert.equal(p.find((x) => x.id === '7d').netUsd, 4e9);
    assert.equal(p.find((x) => x.id === 'ytd').netUsd, 4e9);
    // A day older than every row we hold has nothing inside it.
    const { periods: q } = await periods({ now: NOW + 400 * DAY });
    assert.equal(q.find((x) => x.id === '24h').netUsd, null);
    assert.equal(q.find((x) => x.id === '1y').netUsd, null);
  });

  test('each period adds up only the days inside it', async () => {
    await put('Binance', [on(0, 1e9), on(3, 2e9), on(60, 5e9), on(300, 9e9)]);
    const { periods: p } = await periods({ now: NOW });
    const by = Object.fromEntries(p.map((x) => [x.id, x.netUsd]));
    assert.equal(by['24h'], 1e9);
    assert.equal(by['7d'], 3e9);
    assert.equal(by['1m'], 3e9);
    assert.equal(by['6m'], 8e9);
    assert.equal(by['1y'], 17e9);
  });

  test('year to date is a date, not a duration', async () => {
    // On the second of January it must mean one day, not three hundred and
    // sixty-five — which is the whole reason it is not just another period.
    const jan2 = Date.UTC(2026, 0, 2);
    await store('Binance', [
      { day: '2025-12-20', inUsd: 5e9, outUsd: 0 },
      { day: '2026-01-02', inUsd: 1e9, outUsd: 0 },
    ], { now: jan2 });
    const { periods: p } = await periods({ now: jan2 });
    assert.equal(p.find((x) => x.id === 'ytd').netUsd, 1e9, 'last year leaked into this one');
    assert.equal(startOfYear(jan2), '2026-01-01');
  });

  test('the venues are split out, biggest mover first', async () => {
    await put('Binance', [on(1, 1e9)]);
    await put('OKX', [on(1, -6e9)]);
    await put('Bybit', [on(1, 2e9)]);
    const { periods: p } = await periods({ now: NOW });
    const week = p.find((x) => x.id === '7d');
    assert.deepEqual(week.venues.map((v) => v.venue), ['OKX', 'Bybit', 'Binance']);
    assert.equal(week.netUsd, -3e9);
  });

  test('a period longer than the record says so rather than pretending', async () => {
    await put('Binance', [on(2, 1e9)]);
    const { periods: p } = await periods({ now: NOW });
    assert.equal(p.find((x) => x.id === '7d').covered, false);
    assert.equal(p.find((x) => x.id === '24h').covered, false, 'one day of record cannot cover a day');
  });

  test('a day written twice is replaced, not added to', async () => {
    // A published balance can be revised when an exchange discloses a new
    // wallet. The corrected number is the one to keep; adding would compound.
    await put('Binance', [{ day: '2026-09-06', inUsd: 5e9, outUsd: 0 }]);
    await put('Binance', [{ day: '2026-09-06', inUsd: 1e9, outUsd: 0 }]);
    const { periods: p } = await periods({ now: NOW });
    assert.equal(p.find((x) => x.id === '7d').inUsd, 1e9);
  });

  test('two venues on one day are both kept', async () => {
    await put('Binance', [{ day: '2026-09-06', inUsd: 1e9, outUsd: 0 }]);
    await put('OKX', [{ day: '2026-09-06', inUsd: 2e9, outUsd: 0 }]);
    const { periods: p } = await periods({ now: NOW });
    assert.equal(p.find((x) => x.id === '7d').inUsd, 3e9);
  });
});

describe('the exchange list', () => {
  const listing = (cexs) => ({
    ok: true,
    status: 200,
    json: async () => ({ cexs }),
  });

  test('exchanges with no published wallets are named, not dropped', async () => {
    // A market-wide total that silently omits Coinbase is worse than one that
    // admits it is missing Coinbase.
    const { exchanges, missing } = await listExchanges({
      fetcher: async () => listing([
        { name: 'Binance', slug: 'Binance-CEX', currentTvl: 170e9 },
        { name: 'Coinbase', slug: undefined, currentTvl: 0 },
        { name: 'OKX', slug: 'okx', currentTvl: 30e9 },
      ]),
    });
    assert.deepEqual(exchanges.map((e) => e.name), ['Binance', 'OKX']);
    assert.deepEqual(missing, ['Coinbase']);
  });

  test('the biggest come first, and the list is capped', async () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      ({ name: `E${i}`, slug: `e${i}`, currentTvl: i * 1e9 }));
    const { exchanges } = await listExchanges({ fetcher: async () => listing(many), limit: 5 });
    assert.equal(exchanges.length, 5);
    assert.equal(exchanges[0].name, 'E39');
  });

  test('a bad answer throws rather than returning an empty market', async () => {
    await assert.rejects(
      () => listExchanges({ fetcher: async () => ({ ok: false, status: 503 }) }),
      /503/,
    );
  });
});

describe('the shape the card depends on', () => {
  test('the periods are the six it draws, ending with the one people ask for', () => {
    assert.deepEqual(HISTORY_PERIODS.map((p) => p.id), ['24h', '7d', '1m', '6m', '1y', 'ytd']);
  });

  test('a day is UTC, not whatever the server thinks local is', () => {
    assert.equal(dayOf(Date.UTC(2026, 0, 1, 23, 30) / 1000), '2026-01-01');
  });
});

describe('an exchange that publishes twice in one day', () => {
  // Three of the sixteen do, which produced two rows for one date and a
  // unique-constraint failure on the way into the table. Dropping the duplicate
  // would have fixed the error and left the arithmetic wrong.
  const twice = {
    tokens: [
      { date: Date.parse('2026-09-01T00:00:00Z') / 1000, tokens: { BTC: 100 } },
      { date: Date.parse('2026-09-02T04:00:00Z') / 1000, tokens: { BTC: 105 } },
      { date: Date.parse('2026-09-02T20:00:00Z') / 1000, tokens: { BTC: 120 } },
      { date: Date.parse('2026-09-03T00:00:00Z') / 1000, tokens: { BTC: 121 } },
    ],
    tokensInUsd: [
      { date: Date.parse('2026-09-01T00:00:00Z') / 1000, tokens: { BTC: 100 } },
      { date: Date.parse('2026-09-02T04:00:00Z') / 1000, tokens: { BTC: 105 } },
      { date: Date.parse('2026-09-02T20:00:00Z') / 1000, tokens: { BTC: 120 } },
      { date: Date.parse('2026-09-03T00:00:00Z') / 1000, tokens: { BTC: 121 } },
    ],
  };

  test('one row per day, never two', () => {
    const out = dailyFlows(twice);
    assert.deepEqual(out.map((r) => r.day), ['2026-09-02', '2026-09-03']);
    assert.equal(new Set(out.map((r) => r.day)).size, out.length);
  });

  test('the day runs from where it started to where it ended', () => {
    // 100 to 120 across the second, not 100 to 105 with the rest discarded.
    const [second, third] = dailyFlows(twice);
    assert.equal(second.netUsd, 20);
    assert.equal(third.netUsd, 1);
  });

  test('and the rows can actually be stored', async () => {
    const written = await store('Twice', dailyFlows(twice), { now: NOW });
    assert.equal(written, 2);
  });
});

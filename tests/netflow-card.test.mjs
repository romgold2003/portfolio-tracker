/**
 * The market-wide exchange netflow card.
 *
 * Three things here would each be worse than having no card at all, so each is
 * pinned rather than trusted:
 *
 *   - **The sign inverts.** Coins arriving on an exchange is bearish, so the
 *     bullish reading is the negative number.
 *   - **A venue moving its own float is not flow.** Binance hot to Binance cold
 *     happens constantly and in enormous size; counted, it swamps everything.
 *   - **It must not follow the coin picker.** It answers a question about the
 *     market, and slicing it to one asset would silently answer a different one.
 */
import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { useDriver } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import {
  PERIODS, signalOf, classifyTransfer, aggregate, summarise,
  roll, fromRollup, build, resetTableCache, dayOf,
} from '../api/_lib/netflowcard.js';

const NOW = 1_790_000_000_000;
const AT = Math.floor(NOW / 1000) - 3600;

/** Two venues, two wallets each, so same-venue and cross-venue both testable. */
const LABELS = new Map([
  ['0xbin1', { venue: 'Binance', name: 'Binance 14' }],
  ['0xbin2', { venue: 'Binance', name: 'Binance cold' }],
  ['0xcb1', { venue: 'Coinbase', name: 'Coinbase 1' }],
]);

const move = (from, to, usd, over = {}) => ({
  at: AT, kind: 'transfer', symbol: 'ETH', usd,
  from: { address: from }, to: { address: to }, ...over,
});

beforeEach(() => {
  useDriver(sqliteDriver());
  resetTableCache();
});

describe('the five periods asked for', () => {
  test('24H, 7D, 1M, 6M, 1Y — in that order', () => {
    assert.deepEqual(PERIODS.map((p) => p.label), ['24H', '7D', '1M', '6M', '1Y']);
  });

  test('the long two come from the daily rollup, the short three from raw rows', () => {
    // Six months of raw transfers is not something to walk on a refresh, and at
    // that length a day-level total is the same number, not an approximation.
    assert.deepEqual(PERIODS.filter((p) => p.rollup).map((p) => p.id), ['6m', '1y']);
    assert.deepEqual(PERIODS.filter((p) => !p.rollup).map((p) => p.id), ['24h', '7d', '1m']);
  });
});

describe('the sign, which inverts', () => {
  test('coins leaving exchanges is negative and bullish', () => {
    const t = summarise(aggregate([move('0xbin1', '0xwhale', 5_000_000_000)],
      { byAddress: LABELS, now: NOW }));
    assert.equal(t.outUsd, 5_000_000_000);
    assert.equal(t.netUsd, -5_000_000_000);
    assert.equal(t.signal, 'Bullish');
  });

  test('coins arriving is positive and bearish', () => {
    const t = summarise(aggregate([move('0xwhale', '0xbin1', 5_000_000_000)],
      { byAddress: LABELS, now: NOW }));
    assert.equal(t.inUsd, 5_000_000_000);
    assert.equal(t.netUsd, 5_000_000_000);
    assert.equal(t.signal, 'Bearish');
  });

  test('a near-balanced market is neutral, however much moved', () => {
    // Ten billion moved and eighty million netted is not a market leaning
    // either way. Calling it bullish because the sign landed there would be
    // inventing conviction.
    assert.equal(signalOf(-80_000_000, 10_000_000_000), 'Neutral');
    assert.equal(signalOf(-800_000_000, 10_000_000_000), 'Bullish');
    assert.equal(signalOf(800_000_000, 10_000_000_000), 'Bearish');
    assert.equal(signalOf(0, 0), 'Neutral');
  });
});

describe('what must not be counted', () => {
  test('a venue moving its own float is ignored entirely', () => {
    // Binance hot to Binance cold. Not capital entering or leaving anything.
    assert.deepEqual(classifyTransfer(move('0xbin1', '0xbin2', 9e9), LABELS), []);
    const t = summarise(aggregate([move('0xbin1', '0xbin2', 9e9)], { byAddress: LABELS, now: NOW }));
    assert.equal(t.grossUsd, 0);
    assert.equal(t.transfers, 0);
  });

  test('a transfer between two different venues nets to zero for the market', () => {
    // Real movement, and it belongs in each venue's own row — but it is not
    // capital entering or leaving the exchange system as a whole.
    const t = summarise(aggregate([move('0xbin1', '0xcb1', 1_000_000_000)],
      { byAddress: LABELS, now: NOW }));
    assert.equal(t.netUsd, 0);
    assert.equal(t.inUsd, 1_000_000_000);
    assert.equal(t.outUsd, 1_000_000_000);
    // And each venue reads it correctly from its own side.
    const binance = t.venues.find((v) => v.venue === 'Binance');
    const coinbase = t.venues.find((v) => v.venue === 'Coinbase');
    assert.equal(binance.netUsd, -1_000_000_000, 'Binance sent it');
    assert.equal(coinbase.netUsd, 1_000_000_000, 'Coinbase received it');
  });

  test('a transfer touching no exchange is not flow', () => {
    assert.deepEqual(classifyTransfer(move('0xa', '0xb', 9e9), LABELS), []);
  });

  test('mints and contract legs are not exchange flow', () => {
    const rows = [move('0xwhale', '0xbin1', 9e9, { kind: 'mint' })];
    assert.equal(summarise(aggregate(rows, { byAddress: LABELS, now: NOW })).grossUsd, 0);
  });
});

describe('every asset together', () => {
  test('the totals mix coins, because the question is about the market', () => {
    // Not one coin at a time. Slicing this to BTC would answer a different
    // question with the same label on it.
    const rows = [
      move('0xwhale', '0xbin1', 3_000_000_000, { symbol: 'BTC' }),
      move('0xbin1', '0xwhale2', 4_000_000_000, { symbol: 'ETH' }),
      move('0xbin1', '0xwhale3', 1_000_000_000, { symbol: 'USDT' }),
    ];
    const t = summarise(aggregate(rows, { byAddress: LABELS, now: NOW }));
    assert.equal(t.inUsd, 3_000_000_000);
    assert.equal(t.outUsd, 5_000_000_000);
    assert.equal(t.netUsd, -2_000_000_000);
    assert.equal(t.signal, 'Bullish');
  });

  test('the venue breakdown adds back up to the total', () => {
    const rows = [
      move('0xwhale', '0xbin1', 2_000_000_000),
      move('0xcb1', '0xwhale', 3_000_000_000),
    ];
    const t = summarise(aggregate(rows, { byAddress: LABELS, now: NOW }));
    assert.equal(t.venues.reduce((s, v) => s + v.netUsd, 0), t.netUsd);
    assert.equal(t.venues.reduce((s, v) => s + v.inUsd, 0), t.inUsd);
    // Largest first, so the venue driving the number is the one you read.
    assert.equal(t.venues[0].venue, 'Coinbase');
  });

  test('a period only counts what falls inside it', () => {
    const old = move('0xbin1', '0xw', 9e9, { at: AT - 40 * 86400 });
    assert.equal(aggregate([old], { byAddress: LABELS, hours: 24, now: NOW }).outUsd, 0);
    assert.equal(aggregate([old], { byAddress: LABELS, hours: 24 * 366, now: NOW }).outUsd, 9e9);
  });
});

describe('the daily rollup', () => {
  const rows = [
    move('0xwhale', '0xbin1', 4_000_000_000),
    move('0xbin1', '0xwhale', 6_000_000_000),
  ];

  test('a day is written once however many times it is rolled', async () => {
    // A poll sees the same day repeatedly. Appending would multiply it, and a
    // cache that drifts from its source is worse than no cache.
    await roll(rows, { byAddress: LABELS, now: NOW });
    await roll(rows, { byAddress: LABELS, now: NOW });
    const back = await fromRollup({ hours: 24 * 366, now: NOW });
    assert.equal(back.inUsd, 4_000_000_000);
    assert.equal(back.outUsd, 6_000_000_000);
  });

  test('what comes back out matches what went in', async () => {
    await roll(rows, { byAddress: LABELS, now: NOW });
    const live = summarise(aggregate(rows, { byAddress: LABELS, hours: 24, now: NOW }));
    const rolled = summarise(await fromRollup({ hours: 24 * 366, now: NOW }));
    assert.equal(rolled.netUsd, live.netUsd);
    assert.equal(rolled.signal, live.signal);
  });

  test('a day outside the period is not counted', async () => {
    await roll([move('0xbin1', '0xw', 9e9, { at: AT - 300 * 86400 })],
      { byAddress: LABELS, days: 400, now: NOW });
    assert.equal((await fromRollup({ hours: 24 * 7, now: NOW })).outUsd, 0);
    assert.equal((await fromRollup({ hours: 24 * 366, now: NOW })).outUsd, 9e9);
  });

  test('the day key is the transfer\'s day, not today', async () => {
    const yesterday = dayOf(AT - 86400);
    await roll([move('0xbin1', '0xw', 1e9, { at: AT - 86400 })],
      { byAddress: LABELS, days: 5, now: NOW });
    const { rows: stored } = await (await import('../api/_lib/db.js')).query(
      'SELECT day FROM netflow_daily', [],
    );
    assert.equal(stored[0].day, yesterday);
  });
});

describe('the card as a whole', () => {
  test('five rows come back, each with its own venue breakdown', async () => {
    const rows = [
      move('0xwhale', '0xbin1', 4_200_000_000),
      move('0xbin1', '0xwhale', 5_100_000_000),
    ];
    await roll(rows, { byAddress: LABELS, now: NOW });
    const card = await build({ rows, byAddress: LABELS, now: NOW });

    assert.equal(card.length, 5);
    assert.deepEqual(card.map((p) => p.label), ['24H', '7D', '1M', '6M', '1Y']);

    const day = card[0];
    assert.equal(day.inUsd, 4_200_000_000);
    assert.equal(day.outUsd, 5_100_000_000);
    assert.equal(day.netUsd, -900_000_000);
    assert.equal(day.signal, 'Bullish');
    assert.ok(day.venues.length >= 1);

    // The long periods say where their number came from.
    assert.equal(card.find((p) => p.id === '1y').source, 'daily');
    assert.equal(card.find((p) => p.id === '24h').source, 'live');
  });

  test('an empty book is five neutral rows, not a crash', async () => {
    const card = await build({ rows: [], byAddress: LABELS, now: NOW });
    assert.equal(card.length, 5);
    for (const p of card) {
      assert.equal(p.signal, 'Neutral');
      assert.equal(p.netUsd, 0);
      assert.deepEqual(p.venues, []);
    }
  });
});

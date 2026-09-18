/**
 * Price histories, fetched the same way on every device.
 *
 * Reported: one imported history showed the same account value on two devices
 * and different returns on every timeframe. The returns are built from these
 * series, and a device could keep a day-old copy from the cache, or lose a
 * ticker to one dropped request and never ask again that session. Leaving one or
 * two holdings unpriced moved that account's year from +20.9% to +15.5%.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { dailySeries, setRetryDelayForTests, splitsOf } from '../src/services/history.js';
import { lastClosedSession } from '../src/config/marketCalendar.js';

const rows = [{ date: '2026-09-10', close: 10 }, { date: '2026-09-11', close: 11 }];
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

let calls;
const realFetch = globalThis.fetch;
const answer = (responses) => {
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
};

beforeEach(() => { calls = []; setRetryDelayForTests(0); });
afterEach(() => { globalThis.fetch = realFetch; });

describe('a ticker\'s price history', () => {
  test('is asked for up to the last closed market day, by name', async () => {
    answer([reply(200, { rows })]);
    assert.deepEqual(await dailySeries('AAA'), rows);
    assert.match(calls[0], new RegExp(`symbol=AAA&years=3&through=${lastClosedSession()}$`));
  });

  test('is asked for again when the request is refused or dropped', async () => {
    answer([reply(503, {}), new Error('network down'), reply(200, { rows })]);
    assert.deepEqual(await dailySeries('BBB'), rows);
    assert.equal(calls.length, 3);
  });

  test('gives up after three tries rather than asking all session', async () => {
    answer([reply(429, {}), reply(429, {}), reply(429, {})]);
    assert.equal(await dailySeries('CCC'), null);
    assert.equal(calls.length, 3);
  });

  test('is not asked for again when the server says no outright', async () => {
    answer([reply(401, { error: 'Not signed in.' })]);
    assert.equal(await dailySeries('DDD'), null);
    assert.equal(calls.length, 1);
  });

  test('is fetched once a day, then served from the same copy', async () => {
    answer([reply(200, { rows })]);
    await dailySeries('EEE');
    assert.deepEqual(await dailySeries('EEE'), rows);
    assert.equal(calls.length, 1);
  });
});

describe('the splits a price history is adjusted for', () => {
  test('come back with the series and are kept for pricing past days', async () => {
    const splits = [{ date: '2026-05-28', numerator: 1, denominator: 4 }];
    answer([reply(200, { rows, splits })]);
    await dailySeries('FFF');
    assert.deepEqual(splitsOf('FFF'), splits);
  });

  test('are none for a ticker that never split, or whose series has not loaded', async () => {
    answer([reply(200, { rows })]);
    await dailySeries('GGG');
    assert.deepEqual(splitsOf('GGG'), []);
    assert.deepEqual(splitsOf('NOT-LOADED'), []);
  });
});

describe('the all-time high', () => {
  test('is the highest value of the whole history, the latest day it was reached', async () => {
    const { allTimeHigh } = await import('../src/core/snapshots.js');
    const rows = [
      { date: '2026-01-01', totalAccountValue: 100 },
      { date: '2026-02-01', totalAccountValue: 130 },
      { date: '2026-03-01', totalAccountValue: 120 },
      { date: '2026-04-01', totalAccountValue: 130 },
    ];
    assert.deepEqual(allTimeHigh(rows), { date: '2026-04-01', value: 130 });
    assert.equal(allTimeHigh([]), null);
  });

  test('moves to a new high the day there is one', async () => {
    const { allTimeHigh } = await import('../src/core/snapshots.js');
    const rows = [{ date: '2026-01-01', value: 100 }, { date: '2026-01-02', value: 99 }];
    assert.equal(allTimeHigh(rows).date, '2026-01-01');
    rows.push({ date: '2026-01-03', value: 101 });
    assert.equal(allTimeHigh(rows).date, '2026-01-03');
  });
});

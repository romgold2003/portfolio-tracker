/**
 * The recorded history of net gamma and delta exposure.
 *
 * This series cannot be fetched — no source sells the option chain as it stood
 * an hour ago at a price worth paying — so it is kept, stamped to the minute,
 * from the first time the panel is opened. Three things about that are easy to
 * get quietly wrong: readings have to land in slots or the row count follows
 * how often somebody refreshed, a second reading in one slot must replace the
 * first rather than add a row, and the numbers are far too large for an integer
 * column, so they go in as text and have to come back out as numbers.
 */
import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { useDriver } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import {
  recordReading, readHistory, trackExposure, resetTableCache, readingSlot,
} from '../api/_lib/exposureHistory.js';

const profile = (netGex, netDex, spot = 60000, gammaFlip = null) => ({
  spot, netGex, netDex, gammaFlip,
});

const at = (iso) => new Date(iso);

beforeEach(() => {
  useDriver(sqliteDriver());
  resetTableCache();
});

describe('slotting a reading', () => {
  test('a moment falls into its five-minute slot', () => {
    assert.equal(readingSlot(at('2026-09-03T14:37:12Z')), '2026-09-03T14:35:00Z');
    assert.equal(readingSlot(at('2026-09-03T14:35:00Z')), '2026-09-03T14:35:00Z');
    assert.equal(readingSlot(at('2026-09-03T14:39:59Z')), '2026-09-03T14:35:00Z');
    assert.equal(readingSlot(at('2026-09-03T14:40:00Z')), '2026-09-03T14:40:00Z');
  });

  test('slots sort as text, which is how they are ordered and compared', () => {
    const slots = ['2026-09-03T09:05:00Z', '2026-09-03T14:35:00Z', '2026-09-02T23:55:00Z'];
    assert.deepEqual([...slots].sort(), [slots[2], slots[0], slots[1]]);
  });
});

describe('keeping a reading', () => {
  test('a reading is written and read back as numbers', async () => {
    await recordReading('BTC', profile(1_234_567_890, -987_654_321, 61_500, 59_000), at('2026-09-03T14:37:00Z'));

    const rows = await readHistory('BTC');
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      at: '2026-09-03T14:35:00Z',
      spot: 61_500,
      netGex: 1_234_567_890,
      netDex: -987_654_321,
      gammaFlip: 59_000,
    });
  });

  test('exposure larger than a 32-bit column survives the round trip', async () => {
    // Net GEX on the S&P runs to eleven figures. An INTEGER column would have
    // silently mangled this, which is the whole reason it is stored as text.
    const huge = 84_215_930_411;
    await recordReading('SPX', profile(huge, -huge, 6800), at('2026-09-03T14:37:00Z'));

    const [row] = await readHistory('SPX');
    assert.equal(row.netGex, huge);
    assert.equal(row.netDex, -huge);
  });

  test('two readings in one slot are one row, and the later one wins', async () => {
    await recordReading('BTC', profile(100, 200), at('2026-09-03T14:36:00Z'));
    await recordReading('BTC', profile(300, 400), at('2026-09-03T14:39:00Z'));

    const rows = await readHistory('BTC');
    assert.equal(rows.length, 1, 'the same slot was written twice');
    assert.equal(rows[0].netGex, 300, 'the later reading is the one kept');
  });

  test('refreshing all day cannot cost more than a slot an interval', async () => {
    // Twelve requests across one hour land in twelve slots, not twelve hundred.
    for (let m = 0; m < 60; m++) {
      await recordReading('BTC', profile(m, m), at(`2026-09-03T14:${String(m).padStart(2, '0')}:30Z`));
    }
    assert.equal((await readHistory('BTC')).length, 12);
  });

  test('a missing gamma flip stays missing rather than becoming zero', async () => {
    await recordReading('BTC', profile(100, 200, 60000, null), at('2026-09-03T14:37:00Z'));
    assert.equal((await readHistory('BTC'))[0].gammaFlip, null);
  });

  test('markets are kept apart', async () => {
    await recordReading('BTC', profile(1, 1), at('2026-09-03T14:37:00Z'));
    await recordReading('SPX', profile(2, 2), at('2026-09-03T14:37:00Z'));

    assert.equal((await readHistory('BTC')).length, 1);
    assert.equal((await readHistory('BTC'))[0].netGex, 1);
    assert.equal((await readHistory('SPX'))[0].netGex, 2);
  });

  test('history comes back oldest first, however it went in', async () => {
    for (const t of ['14:35', '09:05', '11:20']) {
      await recordReading('BTC', profile(1, 1), at(`2026-09-03T${t}:00Z`));
    }
    assert.deepEqual((await readHistory('BTC')).map((r) => r.at), [
      '2026-09-03T09:05:00Z', '2026-09-03T11:20:00Z', '2026-09-03T14:35:00Z',
    ]);
  });

  test('the cap keeps the most recent readings, not the first ones', async () => {
    for (let h = 1; h <= 10; h++) {
      await recordReading('BTC', profile(h, h), at(`2026-09-03T${String(h).padStart(2, '0')}:00:00Z`));
    }
    const rows = await readHistory('BTC', { limit: 3 });
    assert.deepEqual(rows.map((r) => r.at.slice(11, 16)), ['08:00', '09:00', '10:00']);
  });

  test('nothing recorded is an empty history, not a failure', async () => {
    assert.deepEqual(await readHistory('NDX'), []);
  });
});

describe('recording alongside the chart', () => {
  test('records and hands back everything so far', async () => {
    await recordReading('BTC', profile(10, 20), at('2026-09-03T13:00:00Z'));
    const history = await trackExposure('BTC', profile(30, 40), at('2026-09-03T14:00:00Z'));

    assert.equal(history.length, 2);
    assert.equal(history[1].netGex, 30);
  });

  test('readings older than the retention window are dropped', async () => {
    await recordReading('BTC', profile(1, 1), at('2024-01-01T00:00:00Z'));
    const history = await trackExposure('BTC', profile(2, 2), at('2026-09-03T14:00:00Z'));

    assert.equal(history.length, 1, 'a reading from two years ago should have aged out');
    assert.equal(history[0].netGex, 2);
  });

  test('a database that throws costs the history, not the chart', async () => {
    useDriver({ async query() { throw new Error('no database today'); } });
    resetTableCache();
    assert.equal(await trackExposure('BTC', profile(1, 2)), null);
  });

  test('no database at all is null rather than an error', async () => {
    useDriver(null);
    resetTableCache();
    assert.equal(await trackExposure('BTC', profile(1, 2)), null);
  });
});

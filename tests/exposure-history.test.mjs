/**
 * The recorded history of net gamma and delta exposure.
 *
 * This series cannot be fetched — no free source publishes yesterday's option
 * chain — so it is kept, one reading a day, from the first time the panel is
 * opened. Two things about that are easy to get quietly wrong: a second reading
 * on the same day must replace the first rather than add a row, and the numbers
 * are far too large for an integer column, so they go in as text and have to
 * come back out as numbers.
 */
import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { useDriver } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import {
  recordReading, readHistory, trackExposure, resetTableCache,
} from '../api/_lib/exposureHistory.js';

const profile = (netGex, netDex, spot = 60000, gammaFlip = null) => ({
  spot, netGex, netDex, gammaFlip,
});

/** Midday in New York, so the reading lands on the day the test names. */
const at = (day) => new Date(`${day}T16:00:00Z`);

beforeEach(() => {
  useDriver(sqliteDriver());
  resetTableCache();
});

describe('keeping a reading', () => {
  test('a day is written and read back as numbers', async () => {
    await recordReading('BTC', profile(1_234_567_890, -987_654_321, 61_500, 59_000), at('2026-09-03'));

    const rows = await readHistory('BTC');
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      day: '2026-09-03',
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
    await recordReading('SPX', profile(huge, -huge, 6800), at('2026-09-03'));

    const [row] = await readHistory('SPX');
    assert.equal(row.netGex, huge);
    assert.equal(row.netDex, -huge);
  });

  test('a second reading the same day replaces the first', async () => {
    // Both are the same New York day: 09:00 UTC is 05:00 there, 20:00 is 16:00.
    await recordReading('BTC', profile(100, 200), new Date('2026-09-03T09:00:00Z'));
    await recordReading('BTC', profile(300, 400), new Date('2026-09-03T20:00:00Z'));

    const rows = await readHistory('BTC');
    assert.equal(rows.length, 1, 'the same day was recorded twice');
    assert.equal(rows[0].netGex, 300, 'the later reading is the one kept');
  });

  test('a missing gamma flip stays missing rather than becoming zero', async () => {
    await recordReading('BTC', profile(100, 200, 60000, null), at('2026-09-03'));
    assert.equal((await readHistory('BTC'))[0].gammaFlip, null);
  });

  test('markets are kept apart', async () => {
    await recordReading('BTC', profile(1, 1), at('2026-09-03'));
    await recordReading('SPX', profile(2, 2), at('2026-09-03'));

    assert.equal((await readHistory('BTC')).length, 1);
    assert.equal((await readHistory('BTC'))[0].netGex, 1);
    assert.equal((await readHistory('SPX'))[0].netGex, 2);
  });

  test('history comes back oldest first, however it went in', async () => {
    for (const day of ['2026-09-03', '2026-09-01', '2026-09-02']) {
      await recordReading('BTC', profile(1, 1), at(day));
    }
    const days = (await readHistory('BTC')).map((r) => r.day);
    assert.deepEqual(days, ['2026-09-01', '2026-09-02', '2026-09-03']);
  });

  test('the cap keeps the most recent days, not the first ones', async () => {
    for (let i = 1; i <= 10; i++) {
      await recordReading('BTC', profile(i, i), at(`2026-09-${String(i).padStart(2, '0')}`));
    }
    const rows = await readHistory('BTC', { days: 3 });
    assert.deepEqual(rows.map((r) => r.day), ['2026-09-08', '2026-09-09', '2026-09-10']);
  });

  test('nothing recorded is an empty history, not a failure', async () => {
    assert.deepEqual(await readHistory('NDX'), []);
  });
});

describe('recording alongside the chart', () => {
  test('records and hands back everything so far', async () => {
    await recordReading('BTC', profile(10, 20), at('2026-09-02'));
    const history = await trackExposure('BTC', profile(30, 40), at('2026-09-03'));

    assert.equal(history.length, 2);
    assert.equal(history[1].netGex, 30);
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

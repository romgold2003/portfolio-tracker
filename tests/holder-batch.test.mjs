/**
 * The holder snapshot writes in batches, and still writes the same thing.
 *
 * Measured on 1 October 2026 the scheduled poll's transfer sweep ran out of
 * its 45-second budget on every run, inside the holder snapshot: "storing 39
 * transfers 6.2s, now in holder snapshot for 36.4s". It wrote about 800
 * balances with two queries each, and each query crossed from the function's
 * region to the database's at about 80 ms. Batched, it is one delete and one
 * insert per token.
 *
 * What has to hold is that nothing about the stored result changed: one row
 * per holder per day, a later reading replacing an earlier one, a holder
 * listed twice keeping its last reading.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { useDriver, query } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import { record, resetTableCache } from '../api/_lib/holders.js';

const NOW = Date.UTC(2026, 9, 1, 12);

/** The real driver, with a count of the statements sent through it. */
let sent = 0;
beforeEach(() => {
  const real = sqliteDriver();
  sent = 0;
  useDriver({
    ...real,
    query: (text, params) => {
      if (/^\s*(INSERT|DELETE)/i.test(text) && /holder_balances/.test(text)) sent += 1;
      return real.query(text, params);
    },
  });
  resetTableCache();
});

const holder = (i, over = {}) => ({
  chain: 'ethereum', token: '0xtoken', holder: `0xholder${i}`, symbol: 'LINK', name: null,
  kind: 'wallet', units: 1000 + i, usd: 15_000 + i, ...over,
});

const stored = async () => (await query(
  'SELECT holder, units, usd FROM holder_balances ORDER BY holder', [],
)).rows;

describe('batched', () => {
  test('fifty holders of one token take two statements, not a hundred', async () => {
    await record(Array.from({ length: 50 }, (_, i) => holder(i)), { now: NOW });
    assert.equal(sent, 2);
    assert.equal((await stored()).length, 50);
  });

  test('a snapshot the size of the real one stays in the dozens', async () => {
    // Two chains, eight tokens, fifty holders: the shape that ran out of time.
    const rows = [];
    for (const chain of ['ethereum', 'polygon']) {
      for (let t = 0; t < 8; t++) {
        for (let i = 0; i < 50; i++) rows.push(holder(i, { chain, token: `0xtoken${t}` }));
      }
    }
    const written = await record(rows, { now: NOW });
    assert.equal(written, 800);
    assert.equal(sent, 32, 'one delete and one insert for each of sixteen tokens');
  });

  test('more holders than one batch holds are all written', async () => {
    await record(Array.from({ length: 120 }, (_, i) => holder(i)), { now: NOW });
    assert.equal((await stored()).length, 120);
    assert.equal(sent, 6, 'three batches of up to fifty');
  });
});

describe('and stores exactly what it stored before', () => {
  test('a later reading the same day replaces the earlier one', async () => {
    await record([holder(1, { units: 5, usd: 50 })], { now: NOW });
    await record([holder(1, { units: 9, usd: 90 })], { now: NOW + 3600_000 });
    const rows = await stored();
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].units), 9);
  });

  test('a holder listed twice keeps its last reading instead of failing the batch', async () => {
    const written = await record([holder(1, { units: 5 }), holder(2), holder(1, { units: 7 })], { now: NOW });
    assert.equal(written, 2);
    const rows = await stored();
    assert.deepEqual(rows.map((r) => [r.holder, Number(r.units)]), [['0xholder1', 7], ['0xholder2', 1002]]);
  });

  test('another day is a separate row, not a replacement', async () => {
    await record([holder(1)], { now: NOW });
    await record([holder(1)], { now: NOW + 86_400_000 });
    const days = (await query('SELECT day FROM holder_balances ORDER BY day', [])).rows.map((r) => r.day);
    assert.deepEqual(days, ['2026-10-01', '2026-10-02']);
  });

  test('replacing one holder leaves the token\'s others alone', async () => {
    await record([holder(1), holder(2), holder(3)], { now: NOW });
    await record([holder(2, { units: 1 })], { now: NOW });
    assert.equal((await stored()).length, 3);
  });

  test('nothing to write writes nothing', async () => {
    assert.equal(await record([], { now: NOW }), 0);
    assert.equal(sent, 0);
  });
});

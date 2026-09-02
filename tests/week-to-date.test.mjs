/**
 * "This week" means since the close before Monday.
 *
 * It used to be a rolling seven days — on a Wednesday it measured from the
 * previous Wednesday, which is a week but not *this* week. These pin the
 * boundary, which is the whole of the change.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { weekOf, newYorkDay } from '../api/_lib/week.js';

/**
 * localStorage is what the price log persists into, and Node has none. A stub
 * is enough: the log only ever reads it once at load and writes it after.
 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { STORAGE_KEYS } = await import('../src/config/constants.js');
const { logPrice, getWeekChg, loadPriceLog, mondayOfWeek } = await import('../src/services/priceLog.js');
const KEY = STORAGE_KEYS.priceLog;

describe('which week a day belongs to', () => {
  test('Monday opens its own week', () => {
    assert.deepEqual(weekOf('2026-08-31'), { from: '2026-08-31', to: '2026-09-06' });
  });

  test('Wednesday looks back to that Monday', () => {
    assert.equal(weekOf('2026-09-02').from, '2026-08-31');
  });

  test('Sunday closes the week that began six days earlier', () => {
    // The off-by-one this invites: Sunday is 0, so a naive shift puts it at the
    // start of the week that has not begun yet.
    assert.equal(weekOf('2026-09-06').from, '2026-08-31');
  });

  test('the next Monday starts a new one', () => {
    assert.equal(weekOf('2026-09-07').from, '2026-09-07');
  });

  test('a week crossing the new year is still seven days', () => {
    assert.deepEqual(weekOf('2026-12-31'), { from: '2026-12-28', to: '2027-01-03' });
  });
});

describe('the market\'s day, not the browser\'s', () => {
  test('a late Israeli evening is still the same New York day', () => {
    // 01:00 Tuesday in Israel is 18:00 Monday in New York. Measuring the week
    // from the local date would move the reference a day early, every week.
    assert.equal(newYorkDay(new Date('2026-09-01T22:00:00Z')), '2026-09-01');
    assert.equal(newYorkDay(new Date('2026-09-02T01:00:00Z')), '2026-09-01');
  });

  test('and rolls over when New York does', () => {
    assert.equal(newYorkDay(new Date('2026-09-02T04:30:00Z')), '2026-09-02');
  });
});

describe('the week change from the logged history', () => {
  beforeEach(() => { store.clear(); loadPriceLog(); });
  afterEach(() => store.clear());

  test('measures from the last price before Monday', () => {
    // Friday 100, then this week. A move to 110 is the week up 10%.
    logPrice('NVDA', 100);
    const monday = '2026-08-31';
    // Rewrite the logged day to the Friday before, which is what a real log
    // would hold by Monday.
    const log = JSON.parse(store.get(KEY));
    log.NVDA[0].d = '2026-08-28';
    store.set(KEY, JSON.stringify(log));
    loadPriceLog();

    assert.equal(getWeekChg('NVDA', 110, monday).toFixed(2), '10.00');
  });

  test('ignores prices from inside the week', () => {
    // Only a Wednesday price on file: there is no week to measure, and
    // measuring from midweek and calling it the week would be worse than
    // saying nothing.
    logPrice('NVDA', 100);
    const log = JSON.parse(store.get(KEY));
    log.NVDA[0].d = '2026-09-02';
    store.set(KEY, JSON.stringify(log));
    loadPriceLog();

    assert.equal(getWeekChg('NVDA', 110, '2026-08-31'), null);
  });

  test('takes the newest of several older prices', () => {
    logPrice('NVDA', 100);
    const log = JSON.parse(store.get(KEY));
    log.NVDA = [
      { d: '2026-08-20', p: 50 },
      { d: '2026-08-28', p: 100 },  // the Friday: this is the one
    ];
    store.set(KEY, JSON.stringify(log));
    loadPriceLog();

    assert.equal(getWeekChg('NVDA', 110, '2026-08-31').toFixed(2), '10.00');
  });

  test('says nothing rather than guessing with no history', () => {
    assert.equal(getWeekChg('NVDA', 110, '2026-08-31'), null);
    assert.equal(getWeekChg('NVDA', 0, '2026-08-31'), null);
  });

  test('agrees with the server on which Monday it is', () => {
    const now = new Date('2026-09-02T15:00:00Z');
    assert.equal(mondayOfWeek(now), weekOf(newYorkDay(now)).from);
  });
});

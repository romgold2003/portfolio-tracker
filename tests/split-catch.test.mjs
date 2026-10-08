/**
 * A split while a holding is open: ETHA, 6 October 2026.
 *
 * iShares did a 1-for-3 reverse split. The price went from yesterday's $20.43
 * close to $61.59 while ether itself sat at $2,700, and the app kept the 66
 * shares of the September statement where IBKR now held 22: the account read
 * $50,600 against IBKR's $47,848, a $2,717 gain from nothing. Yahoo had not yet
 * recorded the split at eleven that morning, so the price had to tell.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { impliedSplit, applySplit, acrossSplit, splitRecorded, splitEvents } from '../src/core/splits.js';
import { buildPortfolioHistory } from '../src/core/portfolioHistory.js';
import { refreshOpenPositions } from '../src/services/prices.js';
import { resetExtendedCache } from '../src/services/extendedHours.js';
import { state, sanitizePositions } from '../src/core/store.js';
import { setCloudEnabled } from '../src/services/cloud.js';
import { curValOf } from '../src/core/portfolio.js';
import { splitLabel } from '../src/ui/views/positionCard.js';

const etha = () => ({
  id: 7, ticker: 'ETHA', cls: 'Stocks', dir: 'Long', status: 'Open',
  open: '2026-02-10', entry: 15.006170606, cur: 61.59, qty: 66, prevClose: 20.43, dailyChg: 201.47,
});

describe('a price jump that is a split', () => {
  test('ETHA: ×3 on yesterday\'s close is a 1-for-3', () => {
    assert.equal(impliedSplit(20.43, 61.59), 1 / 3);
  });

  test('NVDA\'s 10-for-1 and a 2-for-1 the other way', () => {
    assert.equal(impliedSplit(1208.88, 121.79), 10);
    assert.equal(impliedSplit(100, 50.6), 2);
  });

  test('the same morning\'s real moves are moves: AMD +3.4%, a 40% gap, a +80% day', () => {
    assert.equal(impliedSplit(631.75, 653.43), null);
    assert.equal(impliedSplit(100, 140), null);
    assert.equal(impliedSplit(100, 180), null);
    assert.equal(impliedSplit(0, 61.59), null);
  });
});

describe('restating the holding', () => {
  test('66 shares become 22 and the value is IBKR\'s, not three times it', () => {
    const p = etha();
    applySplit(p, 1 / 3, '2026-10-06', 'price');
    assert.equal(p.qty, 22);
    assert.ok(Math.abs(p.entry - 45.0185) < 1e-3);
    assert.ok(Math.abs(curValOf(p) - 1354.98) < 0.01);
    assert.ok(Math.abs(p.prevClose - 61.29) < 1e-9);
  });

  test('the cost is unchanged, so the gain is the gain it was', () => {
    const p = etha();
    const cost = p.entry * p.qty;
    applySplit(p, 1 / 3, '2026-10-06', 'price');
    assert.ok(Math.abs(p.entry * p.qty - cost) < 1e-9);
  });

  test('earlier sales are restated too, or "% closed" reads the vanished shares as sold', () => {
    const p = { ...etha(), origQty: 80, exits: [{ d: '2026-05-01', qty: 14, price: 18, pnl: 40 }] };
    applySplit(p, 1 / 3, '2026-10-06', 'price');
    assert.ok(Math.abs(p.origQty - 80 / 3) < 1e-9);
    assert.ok(Math.abs(p.exits[0].qty - 14 / 3) < 1e-9);
    assert.equal(p.exits[0].pnl, 40);
  });

  test('the day\'s +201% becomes the day\'s +0.5%; one already right is left alone', () => {
    assert.ok(Math.abs(acrossSplit(201.47, 1 / 3) - 0.49) < 0.01);
    assert.equal(acrossSplit(0.49, 1 / 3), 0.49);
  });

  test('a recorded split survives a save and reload, so it is never applied twice', () => {
    const p = etha();
    applySplit(p, 1 / 3, '2026-10-06', 'price');
    const [back] = sanitizePositions(JSON.parse(JSON.stringify([p])));
    assert.deepEqual(back.splits, [{ d: '2026-10-06', k: 1 / 3, source: 'price' }]);
    assert.ok(splitRecorded(back, '2026-10-07'), 'Yahoo dating it a day later is the same split');
  });

  test('the card says what happened, and when it was inferred', () => {
    assert.equal(splitLabel({ d: '2026-10-06', k: 1 / 3, source: 'price' }), '1-for-3 split · Oct 6 (from price)');
    assert.equal(splitLabel({ d: '2024-06-10', k: 10, source: 'yahoo' }), '10-for-1 split · Jun 10');
  });
});

describe('through a real price refresh', () => {
  // Eleven in the morning in New York, the session open.
  const NOW = new Date('2026-10-06T15:00:00Z');
  let realFetch;

  /** The server: yesterday's close in the history, today's price in the quote. */
  function server({ ticker, closes, splits = [], price, previousClose }) {
    return async (url) => {
      const u = String(url);
      if (u.includes('/api/history')) {
        return { ok: true, status: 200, json: async () => ({ symbol: ticker, rows: closes.map(([date, close]) => ({ date, close })), splits }) };
      }
      return {
        ok: true, status: 200,
        json: async () => ({ quotes: [{ symbol: ticker, price, regularClose: price, previousClose, phase: 'regular', at: Math.floor(NOW / 1000) }] }),
      };
    };
  }

  beforeEach(() => {
    realFetch = globalThis.fetch;
    state.positions.length = 0;
    state.apiKey = '';
    state.statements = [{ year: 2026, from: '2026-01-01', to: '2026-09-30' }];
    setCloudEnabled(true);
    resetExtendedCache();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    state.positions.length = 0;
    state.statements = [];
    setCloudEnabled(false);
  });

  test('ETHA the morning of its split: 22 shares, a small day, and it reports a change to save', async () => {
    globalThis.fetch = server({
      ticker: 'ETHA', price: 61.59, previousClose: 20.43,
      closes: [['2026-10-01', 20.6], ['2026-10-02', 20.9], ['2026-10-05', 20.43]],
    });
    state.positions.push({ ...etha(), cur: 20.43, dailyChg: 0 });
    const moved = await refreshOpenPositions(NOW);
    const p = state.positions[0];
    assert.equal(moved, true);
    assert.equal(p.qty, 22);
    assert.ok(Math.abs(p.cur * p.qty - 1354.98) < 0.01);
    assert.ok(Math.abs(p.dailyChg - 0.49) < 0.01, `day reads ${p.dailyChg}`);
    assert.equal(p.splits.length, 1);

    // Every later refresh that morning sees the same jump and must not apply it again.
    await refreshOpenPositions(NOW);
    assert.equal(state.positions[0].qty, 22);
  });

  test('once Yahoo has recorded it, that record is used, and only once', async () => {
    globalThis.fetch = server({
      ticker: 'SPLT', price: 61.59, previousClose: 61.29,
      closes: [['2026-10-05', 61.29], ['2026-10-06', 61.4]],
      splits: [{ date: '2026-10-06', numerator: 1, denominator: 3 }],
    });
    state.positions.push({ ...etha(), ticker: 'SPLT', prevClose: 61.29, dailyChg: 0.49 });
    await refreshOpenPositions(new Date('2026-10-07T15:00:00Z'));
    await refreshOpenPositions(new Date('2026-10-07T15:00:00Z'));
    const p = state.positions[0];
    assert.equal(p.qty, 22);
    assert.equal(p.splits[0].source, 'yahoo');
  });

  test('a split already in the statement\'s count is not applied again', async () => {
    // SCO's 1-for-4 in May 2026 was before the September statement closed.
    globalThis.fetch = server({
      ticker: 'SCO', price: 30.1, previousClose: 30,
      closes: [['2026-10-05', 30]],
      splits: [{ date: '2026-05-12', numerator: 1, denominator: 4 }],
    });
    state.positions.push({ ...etha(), ticker: 'SCO', qty: 26, entry: 28, cur: 30, prevClose: 30, dailyChg: 0.3 });
    await refreshOpenPositions(NOW);
    assert.equal(state.positions[0].qty, 26);
    assert.equal(state.positions[0].splits, undefined);
  });

  test("after four o'clock, with today's close already in the history, it is still caught", async () => {
    globalThis.fetch = server({
      ticker: 'LATE', price: 61.5, previousClose: 20.43,
      closes: [['2026-10-05', 20.43], ['2026-10-06', 61.4]],
    });
    state.positions.push({ ...etha(), ticker: 'LATE', cur: 61.4 });
    await refreshOpenPositions(new Date('2026-10-06T21:30:00Z'));
    assert.equal(state.positions[0].qty, 22);
    assert.equal(state.positions[0].splits[0].d, '2026-10-06');
  });

  test('and on a day the app was not opened, dated the day it happened', async () => {
    globalThis.fetch = server({
      ticker: 'AWAY', price: 62, previousClose: 61.4,
      closes: [['2026-10-05', 20.43], ['2026-10-06', 61.4], ['2026-10-07', 61.4]],
    });
    state.positions.push({ ...etha(), ticker: 'AWAY', cur: 20.43 });
    await refreshOpenPositions(new Date('2026-10-08T15:00:00Z'));
    assert.equal(state.positions[0].qty, 22);
    assert.equal(state.positions[0].splits[0].d, '2026-10-06');
  });

  test('an ordinary day leaves the holding exactly as it was', async () => {
    globalThis.fetch = server({ ticker: 'AMD', price: 653.43, previousClose: 631.75, closes: [['2026-10-05', 631.75]] });
    state.positions.push({ ...etha(), ticker: 'AMD', qty: 10, entry: 125.96, cur: 631.75, prevClose: 631.75 });
    await refreshOpenPositions(NOW);
    assert.equal(state.positions[0].qty, 10);
    assert.equal(state.positions[0].splits, undefined);
  });
});

describe('the chart on the main screen', () => {
  // ETHA alone, as the statement left it: 66 shares, nothing else.
  const closes = { '2026-10-05': 20.43, '2026-10-06': 61.59, '2026-10-07': 61.0 };
  const priceOn = (t, day) => closes[day] ?? null;
  const walk = (events) => buildPortfolioHistory({
    opening: { date: '2026-10-05', cash: 0, holdings: { ETHA: 66 } },
    events, priceOn, from: '2026-10-05', to: '2026-10-07',
  }).map((r) => Math.round(r.totalAccountValue));

  test('without the split it read three times ETHA from the split on — the $50k days', () => {
    assert.deepEqual(walk([]), [1348, 4065, 4026]);
  });

  test('with it, the count changes on the day and the days before are untouched', () => {
    const events = splitEvents([{ ticker: 'ETHA', splits: [{ d: '2026-10-06', k: 1 / 3 }] }]);
    assert.deepEqual(walk(events), [1348, 1355, 1342]);
  });

  test('a split a statement already reported is not applied a second time', () => {
    const held = [{ ticker: 'ETHA', splits: [{ d: '2026-10-06', k: 1 / 3 }] }];
    assert.deepEqual(splitEvents(held, [{ ticker: 'ETHA', date: '2026-10-06', ratio: 1 / 3 }]), []);
    assert.equal(splitEvents(held, [{ ticker: 'SCO', date: '2026-10-06' }]).length, 1);
  });

  test('both history builds on the main screen are given the splits', () => {
    const home = readFileSync(new URL('../src/ui/views/home.js', import.meta.url), 'utf8');
    assert.equal((home.match(/\.\.\.splitEvents\(/g) ?? []).length, 2);
  });
});

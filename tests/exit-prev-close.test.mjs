/**
 * The price a sale is measured from, when the sale is taken.
 *
 * Closing a position stores what the asset closed at yesterday, so the shares
 * still count toward today's move after they are gone. It rebuilt that close
 * from the day's percentage — `cur / (1 + chg)` — instead of reading the close
 * the quote already carried.
 *
 * Those two are the same number only while the price beside them is the one the
 * percentage was computed against, and they arrive on different refreshes: the
 * regular poll, the extended-hours path, an import. A sale taken after a price
 * update but before the next percentage landed was measured from $104.76
 * instead of $100, and credited the day with $524 of a $1,000 move.
 *
 * `dailyDollar` had already been taught to prefer the stored close for exactly
 * this reason. Closing a position had not.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../src/core/store.js';
import { addPosition, closePosition } from '../src/core/positions.js';
import { dailyDollarExits, todayStr } from '../src/core/portfolio.js';

beforeEach(() => { state.positions = []; state.cash = 50_000; state.cashFlows = []; });

const bought = () => addPosition({
  ticker: 'A', cls: 'Stocks', dir: 'Long', open: '2026-01-05', entry: 80, amount: 8000, qty: 100,
});

describe('a sale taken between refreshes', () => {
  test('is measured from the close the quote gave, not one rebuilt from a stale percentage', () => {
    const p = bought();
    p.prevClose = 100;   // yesterday's close, quoted outright
    p.dailyChg = 5;      // worked out when the price was 105
    p.cur = 110;         // a later refresh moved the price; the percentage did not
    closePosition(p.id, 110, 100);

    const [exit] = state.positions[0].exits;
    assert.equal(exit.prevClose, 100, 'rebuilt it gave 104.76');
    assert.equal(dailyDollarExits(state.positions[0], todayStr()), 1000, 'it credited 523.81');
  });

  test('the percentage is still the fallback for a position quoted before the close was stored', () => {
    const p = bought();
    delete p.prevClose;
    p.dailyChg = 10;
    p.cur = 110;
    closePosition(p.id, 110, 100);
    assert.ok(Math.abs(state.positions[0].exits[0].prevClose - 100) < 1e-9);
  });

  test('a position with neither records no starting price, rather than a wrong one', () => {
    const p = bought();
    delete p.prevClose;
    delete p.dailyChg;
    p.cur = 110;
    closePosition(p.id, 110, 100);
    assert.equal(state.positions[0].exits[0].prevClose, null);
    assert.equal(dailyDollarExits(state.positions[0], todayStr()), 0, 'nothing honest to attribute to today');
  });

  test('a partial sale carries the same close, and the shares left keep their own', () => {
    const p = bought();
    p.prevClose = 100;
    p.dailyChg = 5;
    p.cur = 110;
    closePosition(p.id, 110, 40);
    assert.equal(p.exits[0].prevClose, 100);
    assert.equal(p.qty, 60, 'the rest is still held');
    // 40 shares moved 100 -> 110 before they went.
    assert.equal(dailyDollarExits(p, todayStr()), 400);
  });
});

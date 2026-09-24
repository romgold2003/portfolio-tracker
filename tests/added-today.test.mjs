/**
 * Shares bought today start the day at the price paid for them.
 *
 * Reported as a daily percentage that was "always off", by about a quarter of
 * a point, on a book whose account value was exactly right — and the guess that
 * came with it was correct: the system did not know how to read a top-up made
 * the same day.
 *
 * Adding to a holding left the whole of it measured from yesterday's close, so
 * shares bought this morning were credited with a move they were not there for.
 * Ten held from a close of 100 with fifty more bought at 101, the price at 102,
 * read $120 where the day had made $70. The account value is untouched by this
 * — the shares are worth what they are worth — which is exactly why only the
 * percentage looked wrong, and why it was so hard to place.
 *
 * The error is the size of the top-up times the day's move, so it grows with
 * how much was added and stays invisible on a quiet day.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state, sanitizePositions } from '../src/core/store.js';
import { addPosition, applyDca, closePosition } from '../src/core/positions.js';
import {
  addedOn, dailyDollar, dailyDollarTotal, dailyPortfolioMove, accountTotals, todayStr,
} from '../src/core/portfolio.js';

const TODAY = todayStr();
beforeEach(() => { state.positions = []; state.cash = 40_000; state.cashFlows = []; });

/** Ten shares held since last week, which closed yesterday at 100. */
const held = (over = {}) => {
  const p = addPosition({ ticker: 'X', cls: 'Stocks', dir: 'Long', open: '2026-09-10', entry: 100, amount: 1000, qty: 10, ...over });
  p.prevClose = 100;
  p.cur = 102;
  return p;
};

describe('a top-up made today', () => {
  test('is measured from what was paid, not from yesterday\'s close', () => {
    const p = held();
    applyDca(p.id, 50, 101);
    p.cur = 102;
    // 10 from 100 to 102, and 50 from 101 to 102.
    assert.equal(dailyDollar(p, TODAY), 70, 'it read 120 — the whole holding from yesterday');
  });

  test('so the portfolio percentage stops drifting', () => {
    const p = held();
    applyDca(p.id, 50, 101);
    p.cur = 102;
    const account = accountTotals([p], state.cash).account;
    const move = dailyPortfolioMove([p], account, TODAY, []);
    assert.ok(Math.abs(move.percent - (70 / (account - 70)) * 100) < 1e-9, `${move.percent}%`);
  });

  test('several top-ups in one day each start at their own price', () => {
    const p = held();
    p.cur = 110;
    applyDca(p.id, 10, 105);
    applyDca(p.id, 10, 108);
    p.cur = 110;
    // 10 from 100, 10 from 105, 10 from 108, all at 110.
    assert.equal(dailyDollar(p, TODAY), 10 * 10 + 10 * 5 + 10 * 2);
  });

  test('a top-up on a short is measured the same way round', () => {
    const s = addPosition({ ticker: 'USO', cls: 'Stocks', dir: 'Short', open: '2026-09-10', entry: 150, amount: 1500, qty: 10 });
    s.prevClose = 150;
    s.cur = 148;
    applyDca(s.id, 10, 149);
    s.cur = 148;
    // 10 shorted from a close of 150 made 20; 10 shorted today at 149 made 10.
    assert.equal(dailyDollar(s, TODAY), 30);
  });

  test('yesterday\'s top-up is not today\'s business', () => {
    const p = held();
    p.qty = 30;
    p.adds = [{ d: '2026-01-05', qty: 20, price: 90 }];
    // All thirty were held at yesterday's close.
    assert.equal(dailyDollar(p, TODAY), 60);
    assert.deepEqual(addedOn(p, TODAY), { qty: 0, cost: 0 });
  });

  test('a position opened today needs none of this', () => {
    // Its entry price already averages in anything added since.
    const p = addPosition({ ticker: 'N', cls: 'Stocks', dir: 'Long', open: TODAY, entry: 100, amount: 1000, qty: 10 });
    applyDca(p.id, 10, 104);
    p.cur = 106;
    // 20 shares at an average of 102, now 106.
    assert.equal(dailyDollar(p, TODAY), 80);
  });
});

describe('bought and sold on the same day', () => {
  test('the day still adds up', () => {
    const p = held();
    applyDca(p.id, 50, 101);
    p.cur = 102;
    p.prevClose = 100;
    closePosition(p.id, 105, 30);
    // 10 held from 100 -> 102 is 20. Of the 50 bought at 101, thirty went at
    // 105 for 120 and twenty are still held at 102 for 20.
    assert.equal(dailyDollarTotal(p, TODAY), 160);
  });

  test('selling more than was carried in does not turn the day negative', () => {
    const p = held();
    applyDca(p.id, 50, 101);
    p.cur = 102;
    p.prevClose = 100;
    closePosition(p.id, 102, 55);
    // Everything ends at 102: 10 from 100, and 50 from 101.
    assert.equal(dailyDollarTotal(p, TODAY), 70);
  });
});

describe('it survives a reload', () => {
  test('the record of what was added is stored and read back', () => {
    const p = held();
    applyDca(p.id, 50, 101);
    const [reloaded] = sanitizePositions([p]);
    assert.deepEqual(reloaded.adds, [{ d: TODAY, qty: 50, price: 101 }]);
  });

  test('and rubbish in that record is dropped rather than trusted', () => {
    const p = held();
    p.adds = [
      { d: TODAY, qty: 5, price: 100 },
      { d: 'not a date', qty: 5, price: 100 },
      { d: TODAY, qty: null, price: 100 },
      { d: TODAY, qty: 5 },
      'nonsense',
    ];
    const [reloaded] = sanitizePositions([p]);
    assert.deepEqual(reloaded.adds, [{ d: TODAY, qty: 5, price: 100 }]);
  });

  test('a position that was never added to carries no record at all', () => {
    const [reloaded] = sanitizePositions([held()]);
    assert.equal(reloaded.adds, undefined);
  });
});

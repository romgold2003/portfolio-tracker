/**
 * "D% ↓ Worst" has to rank by D%.
 *
 * Both daily sort buttons are labelled with a percentage and both ranked by
 * `dailyDollar` — the day's move in money. So a small holding down six per cent
 * sorted below a large one down one, because the large one had lost more
 * dollars, and the button had said percent. Reported against USO, which was the
 * worst thing in the book that day and would not go to the end of the list.
 *
 * The sort now uses the same number the row prints beside the price, signed for
 * the direction, and gated on the session the way every figure on the page is.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { sortPositions, dailyPercent } from '../src/core/portfolio.js';

/** A holding, sized in dollars so money and percent can be made to disagree. */
function pos(ticker, { pct, qty = 1, price = 100, dir = 'Long' } = {}) {
  return {
    id: ticker, ticker, cls: 'Stocks', dir, status: 'Open',
    entry: price, cur: price, qty,
    ...(pct === undefined ? {} : { dailyChg: pct }),
  };
}

const order = (list, key) => sortPositions(list, key).map((p) => p.ticker);

describe('the day sorts rank by percent, not by money', () => {
  // USO is small and down hard. SPY is large and barely down: more dollars
  // lost, a far smaller move. This is the case that was reported.
  const uso = pos('USO', { pct: -6.2, qty: 10, price: 70 });
  const spy = pos('SPY', { pct: -0.4, qty: 200, price: 560 });

  test('worst puts the biggest faller first, whatever it is worth', () => {
    assert.deepEqual(order([spy, uso], 'dDown'), ['USO', 'SPY']);
  });

  test('best is the same list the other way up', () => {
    assert.deepEqual(order([uso, spy], 'dUp'), ['SPY', 'USO']);
  });

  test('a large holding does not outrank a larger move', () => {
    // SPY loses about $450 on the day; USO about $43. Money would put SPY last.
    const worst = sortPositions([spy, uso], 'dDown')[0];
    assert.equal(worst.ticker, 'USO', 'ranked by dollars again');
  });
});

describe('direction', () => {
  test('a short whose stock rose is a loser', () => {
    const short = pos('TSLA', { pct: 4.0, dir: 'Short' });
    const long = pos('AAPL', { pct: -1.0 });
    assert.deepEqual(order([long, short], 'dDown'), ['TSLA', 'AAPL']);
  });

  test('a short whose stock fell is a winner', () => {
    const short = pos('TSLA', { pct: -4.0, dir: 'Short' });
    const long = pos('AAPL', { pct: 1.0 });
    assert.deepEqual(order([long, short], 'dUp'), ['TSLA', 'AAPL']);
  });

  test('dailyPercent reports the sign the position feels', () => {
    assert.equal(dailyPercent(pos('X', { pct: 4, dir: 'Short' })), -4);
    assert.equal(dailyPercent(pos('X', { pct: 4 })), 4);
  });
});

describe('a position with no daily figure yet', () => {
  const known = pos('AAPL', { pct: -2.0 });
  const unknown = pos('NEW');

  test('is not treated as flat at either end', () => {
    assert.equal(dailyPercent(unknown), null);
    assert.equal(sortPositions([unknown, known], 'dDown')[0].ticker, 'AAPL',
      'an unknown move must not outrank a real fall');
    assert.equal(sortPositions([unknown, known], 'dUp')[0].ticker, 'AAPL',
      'nor a real rise');
  });

  test('and neither is a figure that is not a number', () => {
    for (const bad of [NaN, Infinity, undefined, null]) {
      assert.equal(dailyPercent({ dir: 'Long', dailyChg: bad }), null, String(bad));
    }
  });
});

describe('the other sorts are untouched', () => {
  test('size still ranks by what a holding is worth', () => {
    const big = pos('SPY', { pct: -0.4, qty: 200, price: 560 });
    const small = pos('USO', { pct: -6.2, qty: 10, price: 70 });
    assert.deepEqual(order([small, big], 'size'), ['SPY', 'USO']);
  });

  test('P&L is still the default, and still ranks by open profit', () => {
    const winner = { ...pos('A', { pct: -9 }), entry: 100, cur: 150, qty: 10 };
    const loser = { ...pos('B', { pct: 9 }), entry: 100, cur: 90, qty: 10 };
    assert.deepEqual(order([loser, winner], 'pnl'), ['A', 'B']);
    assert.deepEqual(order([loser, winner], undefined), ['A', 'B']);
  });
});

describe('the caller may supply its own reading of the day', () => {
  test('which is how the session reset reaches a sort that cannot see it', () => {
    const a = pos('A', { pct: -5 });
    const b = pos('B', { pct: -1 });
    // Standing in for "the trading day is over, so every figure reads zero".
    assert.deepEqual(sortPositions([a, b], 'dDown', () => 0).map((p) => p.ticker), ['A', 'B'],
      'with every figure equal the list should keep the order it was given');
  });
});

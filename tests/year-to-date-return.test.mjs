/**
 * The account's return for the year.
 *
 * The bug this exists for: the figure was read off the account curve, which
 * begins the day the app is first opened. Enter a year of trading afterwards
 * and the curve does not move, so the return read the same whether the year had
 * made sixty thousand or nothing — sitting directly beneath the market's own
 * number, which is the worst place for a figure that ignores your trades.
 */
import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../src/core/store.js';
import { addClosedPosition } from '../src/core/positions.js';
import { yearToDatePnl, accountTotals } from '../src/core/portfolio.js';

const NOW = new Date(2026, 7, 30, 12, 0);
const YEAR_START = '2026-01-01';

beforeEach(() => {
  state.positions = [];
  state.snapshots = [];
  state.cash = 0;
});

const open = (over = {}) => ({
  id: Math.random(), ticker: 'AAA', cls: 'Stocks', dir: 'Long', status: 'Open',
  open: '2026-02-01', entry: 100, cur: 120, qty: 10, amount: 1000, ...over,
});

const totalsFor = () => accountTotals(state.positions, state.cash).account;

describe('closed trades', () => {
  test('move the return, which was the whole complaint', () => {
    state.cash = 10000;
    const before = yearToDatePnl(state.positions, totalsFor(), new Map(), NOW);
    assert.equal(before.pnl, 0);

    addClosedPosition({
      ticker: 'VRT', cls: 'Stocks', dir: 'Long',
      open: '2026-01-20', close: '2026-04-18', pnl: 600, pct: 30,
    });

    const after = yearToDatePnl(state.positions, totalsFor(), new Map(), NOW);
    assert.equal(after.pnl, 600, 'a closed winner must show up in the year');
    assert.ok(after.returnPct > 0, 'and must move the return');
  });

  test('ten of them add up to what they made', () => {
    state.cash = 45798.99;
    const trades = [900, 1400, -300, 650, 1100, -450, 780, 1250, 540, 990];
    trades.forEach((pnl, i) => addClosedPosition({
      ticker: `T${i}`, cls: 'Stocks', dir: 'Long',
      open: '2026-01-02', close: `2026-0${(i % 8) + 1}-15`, pnl, pct: pnl > 0 ? 20 : -10,
    }));

    const { pnl } = yearToDatePnl(state.positions, totalsFor(), new Map(), NOW);
    assert.equal(pnl, trades.reduce((a, b) => a + b, 0));
    assert.equal(pnl, 6860);
  });

  test('a loss pulls the return down', () => {
    state.cash = 10000;
    addClosedPosition({
      ticker: 'BAD', cls: 'Stocks', dir: 'Long',
      open: '2026-01-20', close: '2026-04-18', pnl: -800, pct: -20,
    });
    const { pnl, returnPct } = yearToDatePnl(state.positions, totalsFor(), new Map(), NOW);
    assert.equal(pnl, -800);
    assert.ok(returnPct < 0);
  });

  test('one closed last year is not counted in this one', () => {
    state.cash = 10000;
    addClosedPosition({
      ticker: 'OLD', cls: 'Stocks', dir: 'Long',
      open: '2025-03-01', close: '2025-11-20', pnl: 5000, pct: 50,
    });
    const { pnl } = yearToDatePnl(state.positions, totalsFor(), new Map(), NOW);
    assert.equal(pnl, 0, "last year's profit leaked into this year");
  });
});

describe('open positions', () => {
  test('opened this year, their whole gain belongs to this year', () => {
    state.positions = [open({ entry: 100, cur: 120, qty: 10 })];
    const { pnl } = yearToDatePnl(state.positions, totalsFor(), new Map(), NOW);
    assert.equal(pnl, 200);
  });

  test('a short opened this year counts the right way round', () => {
    state.positions = [open({ dir: 'Short', entry: 100, cur: 80, qty: 10 })];
    const { pnl } = yearToDatePnl(state.positions, totalsFor(), new Map(), NOW);
    assert.equal(pnl, 200, 'a short that fell should be a gain');
  });
});

describe('a holding carried in from last year', () => {
  const carried = () => [open({ ticker: 'GOOG', open: '2025-08-14', entry: 100, cur: 200, qty: 5 })];

  test('contributes only the part that happened this year', () => {
    state.positions = carried();
    // Worth 150 on 1 January, 200 now: 50 a share of this year's gain.
    const prices = new Map([['GOOG', 150]]);
    const { pnl, carried: skipped } = yearToDatePnl(state.positions, totalsFor(), prices, NOW);
    assert.equal(pnl, 250, 'only this year\'s move should count');
    assert.equal(skipped, 0);
  });

  test('is left out entirely when its January price is unknown', () => {
    state.positions = carried();
    const { pnl, carried: skipped } = yearToDatePnl(state.positions, totalsFor(), new Map(), NOW);
    assert.equal(pnl, 0, 'a whole lifetime gain was credited to this year');
    assert.equal(skipped, 1, 'and it should say so');
  });

  test('so the answer understates rather than overstates', () => {
    state.positions = carried();
    const withPrice = yearToDatePnl(state.positions, totalsFor(), new Map([['GOOG', 150]]), NOW);
    const without = yearToDatePnl(state.positions, totalsFor(), new Map(), NOW);
    assert.ok(without.pnl < withPrice.pnl, 'the fallback must not exceed the true figure');
  });

  test('a fall since January is a loss for this year', () => {
    state.positions = [open({ ticker: 'GOOG', open: '2025-08-14', entry: 100, cur: 120, qty: 5 })];
    const { pnl } = yearToDatePnl(state.positions, totalsFor(), new Map([['GOOG', 160]]), NOW);
    assert.equal(pnl, -200, 'down from 160 to 120 is a loss, whatever it cost originally');
  });
});

describe('the return itself', () => {
  test('is measured against what the account started the year with', () => {
    state.cash = 10600;
    addClosedPosition({
      ticker: 'VRT', cls: 'Stocks', dir: 'Long',
      open: '2026-01-20', close: '2026-04-18', pnl: 600, pct: 30,
    });
    const { pnl, startEquity, returnPct } = yearToDatePnl(
      state.positions, totalsFor(), new Map(), NOW,
    );
    assert.equal(pnl, 600);
    assert.equal(startEquity, 10000, 'started the year with 10,000');
    assert.ok(Math.abs(returnPct - 6) < 1e-9, '600 on 10,000 is 6%');
  });

  test('is null rather than absurd when the year made more than the account holds', () => {
    // Money withdrawn during the year can leave less now than was earned.
    state.cash = 100;
    addClosedPosition({
      ticker: 'VRT', cls: 'Stocks', dir: 'Long',
      open: '2026-01-20', close: '2026-04-18', pnl: 5000, pct: 30,
    });
    const { returnPct } = yearToDatePnl(state.positions, totalsFor(), new Map(), NOW);
    assert.equal(returnPct, null, 'a negative starting equity is not a base to divide by');
  });

  test('an untouched year reports zero, not nothing', () => {
    state.cash = 10000;
    const { pnl, returnPct } = yearToDatePnl(state.positions, totalsFor(), new Map(), NOW);
    assert.equal(pnl, 0);
    assert.equal(returnPct, 0);
  });
});

describe('money paid in', () => {
  /**
   * The reason this measure replaced the curve-based one, beyond blindness to
   * closed trades. The old figure was (last value - first value) / first, which
   * cannot tell a profit from a deposit — funding the account looked exactly
   * like a spectacular week. Counting from the trades themselves is immune:
   * a deposit moves the account value and makes no P&L, so it moves nothing.
   */
  test('is not mistaken for a return', () => {
    state.cash = 10000;
    state.positions = [open({ entry: 100, cur: 110, qty: 10 })]; // +100 made
    const earned = yearToDatePnl(state.positions, totalsFor(), new Map(), NOW);

    // Now pay in 5,000. Nothing was earned by doing so.
    state.cash += 5000;
    const afterDeposit = yearToDatePnl(state.positions, totalsFor(), new Map(), NOW);

    assert.equal(afterDeposit.pnl, earned.pnl, 'a deposit created profit out of nothing');
    assert.ok(
      afterDeposit.returnPct < earned.returnPct,
      'a bigger account for the same profit is a smaller return, not a larger one',
    );
  });

  test('and withdrawing does not invent a loss', () => {
    state.cash = 10000;
    state.positions = [open({ entry: 100, cur: 110, qty: 10 })];
    const before = yearToDatePnl(state.positions, totalsFor(), new Map(), NOW);
    state.cash -= 3000;
    const after = yearToDatePnl(state.positions, totalsFor(), new Map(), NOW);
    assert.equal(after.pnl, before.pnl, 'a withdrawal destroyed profit that was really made');
  });
});

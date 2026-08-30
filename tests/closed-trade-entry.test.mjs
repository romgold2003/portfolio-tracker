/**
 * Recording a trade that was opened and closed before the app saw it.
 *
 * Someone arriving with a year of trading behind them has to be able to enter
 * it. The ordinary open-then-close path gets that wrong in three ways, and each
 * one is checked here, because each produces a plausible-looking number that is
 * simply false.
 */
import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../src/core/store.js';
import { addPosition, addClosedPosition, closePosition } from '../src/core/positions.js';
import {
  realized, accountTotals, dailyDollarTotal, todayStr, unreal,
} from '../src/core/portfolio.js';

const CASH_AT_START = 7356.44;

beforeEach(() => {
  state.positions = [];
  state.snapshots = [];
  state.apiKey = '';
  state.cash = CASH_AT_START;
});

/** A winner from March: bought at 100, sold at 130, £2,000 in. */
const MARCH_WINNER = {
  ticker: 'VRT',
  cls: 'Stocks',
  dir: 'Long',
  open: '2026-03-03',
  close: '2026-04-18',
  entry: 100,
  exit: 130,
  amount: 2000,
  reason: 'breakout',
};

describe('cash', () => {
  test('is left exactly as it was — the money settled months ago', () => {
    addClosedPosition(MARCH_WINNER);
    assert.equal(state.cash, CASH_AT_START, 'entering a finished trade must not move cash');
  });

  test('unlike the open-then-close path, which would count the profit twice', () => {
    // What entering it the ordinary way does, for contrast.
    const p = addPosition({ ...MARCH_WINNER, close: null });
    closePosition(p.id, MARCH_WINNER.exit, p.qty);

    const gained = state.cash - CASH_AT_START;
    assert.ok(gained > 590 && gained < 610, `expected roughly +600 of double-counted profit, got ${gained}`);

    // Which is the whole reason the other path exists.
    state.positions = [];
    state.cash = CASH_AT_START;
    addClosedPosition(MARCH_WINNER);
    assert.equal(state.cash, CASH_AT_START);
  });

  test('so the account value does not jump by money you already had', () => {
    const before = accountTotals(state.positions, state.cash).account;
    addClosedPosition(MARCH_WINNER);
    const after = accountTotals(state.positions, state.cash).account;
    assert.equal(after, before, 'a finished trade must not inflate the account value');
  });
});

describe('the profit', () => {
  test('is recorded, and is the real one', () => {
    const p = addClosedPosition(MARCH_WINNER);
    // 2000 / 100 = 20 shares, sold 30 higher.
    assert.ok(Math.abs(realized(p) - 600) < 0.01, `expected 600, got ${realized(p)}`);
  });

  test('counts toward realised P&L and the win rate', () => {
    addClosedPosition(MARCH_WINNER);
    const totals = accountTotals(state.positions, state.cash);
    assert.ok(Math.abs(totals.realised - 600) < 0.01);
    assert.equal(totals.wins, 1);
    assert.equal(totals.losses, 0);
  });

  test('and a loser is booked as a loss, not quietly dropped', () => {
    addClosedPosition({ ...MARCH_WINNER, ticker: 'IREN', exit: 80 });
    const totals = accountTotals(state.positions, state.cash);
    assert.ok(totals.realised < 0, 'a losing trade must reduce realised P&L');
    assert.equal(totals.losses, 1);
    assert.equal(totals.wins, 0);
  });

  test('a short is the right way round', () => {
    // Sold at 100, bought back at 80 — a short makes money as the price falls.
    const p = addClosedPosition({ ...MARCH_WINNER, dir: 'Short', exit: 80 });
    assert.ok(realized(p) > 0, 'a short closed lower must be a profit');
    assert.ok(Math.abs(realized(p) - 400) < 0.01, `expected 400, got ${realized(p)}`);
  });
});

describe('the dates', () => {
  test('the exit is stamped when it happened, not today', () => {
    const p = addClosedPosition(MARCH_WINNER);
    assert.equal(p.close, '2026-04-18');
    assert.equal(p.exits[0].d, '2026-04-18');
    assert.notEqual(p.exits[0].d, todayStr(), 'the exit was filed under today');
  });

  test('so it never shows up in today\'s move', () => {
    addClosedPosition(MARCH_WINNER);
    const moved = dailyDollarTotal(state.positions[0]);
    assert.equal(moved, 0, 'a trade closed in April was counted into today\'s P&L');
  });

  test('and ten of them together still move today by nothing', () => {
    for (let i = 0; i < 10; i++) {
      addClosedPosition({ ...MARCH_WINNER, ticker: `T${i}` });
    }
    const moved = state.positions.reduce((sum, p) => sum + dailyDollarTotal(p), 0);
    assert.equal(moved, 0, 'a backlog of finished trades faked a gain today');
  });
});

describe('the position itself', () => {
  test('is closed, with the exit price as its final price', () => {
    const p = addClosedPosition(MARCH_WINNER);
    assert.equal(p.status, 'Closed');
    assert.equal(p.cur, 130);
    assert.ok(Math.abs(p.qty - 20) < 1e-9);
    assert.ok(Math.abs(p.origQty - 20) < 1e-9);
  });

  test('holds no unrealised P&L, being over', () => {
    addClosedPosition(MARCH_WINNER);
    const totals = accountTotals(state.positions, state.cash);
    assert.equal(totals.unrealised, 0);
    assert.equal(totals.open.length, 0);
  });

  test('keeps the reason and an explicit sector', () => {
    const p = addClosedPosition({ ...MARCH_WINNER, sector: 'Technology' });
    assert.equal(p.reason, 'breakout');
    assert.equal(p.sector, 'Technology');
  });

  test('does not invent a sector when none was chosen', () => {
    const p = addClosedPosition(MARCH_WINNER);
    assert.ok(!('sector' in p), 'an unset sector must be left to the ticker lookup');
  });
});

describe('the Monthly page', () => {
  /**
   * The Monthly view buckets by `p.close.slice(0, 7)`. That is the whole reason
   * the close date has to be the real one: stamped with today, a year of
   * trading would pile into the current month and leave the rest of the year
   * empty.
   */
  const bucketOf = (p) => p.close.slice(0, 7);

  test('files each trade under the month it actually closed', () => {
    addClosedPosition(MARCH_WINNER);
    addClosedPosition({
      ...MARCH_WINNER, ticker: 'IREN', open: '2026-02-10', close: '2026-03-20', exit: 62,
    });

    const months = state.positions
      .filter((p) => p.status === 'Closed')
      .map(bucketOf)
      .sort();
    assert.deepEqual(months, ['2026-03', '2026-04']);
  });

  test('and does not put a year of trading into this month', () => {
    for (const close of ['2026-01-14', '2026-02-02', '2026-03-20', '2026-04-18', '2026-05-30']) {
      addClosedPosition({ ...MARCH_WINNER, ticker: `T${close}`, close });
    }
    const distinct = new Set(state.positions.map(bucketOf));
    assert.equal(distinct.size, 5, 'closed trades collapsed into one month');
    assert.ok(!distinct.has(todayStr().slice(0, 7)), 'a past trade was filed under this month');
  });
});

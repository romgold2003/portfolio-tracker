/**
 * The return for 1W, 1M, 3M, 6M, 1Y and All.
 *
 * Reported as wrong, and it was: on a real account with three years of IBKR
 * statements, only year to date matched the broker. A week read −7.90% where it
 * was −0.90%; the year +47.54% where it was +25.45%; all time +97.44% where
 * IBKR's own three years compound to +53.19%. Every window was started from 1
 * January's prices, and all time divided the whole history's profit by the
 * first deposit alone.
 *
 * The replacement measures a window from the account valued every day, and all
 * time from the broker's own yearly figures compounded. Both are pinned here.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { periodReturnFromHistory } from '../src/core/portfolioHistory.js';
import { chainedBrokerReturn, statementRecord, withStatements } from '../src/features/statementLibrary.js';

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const day = (date, totalAccountValue, externalCashFlow = 0) => ({ date, totalAccountValue, externalCashFlow });

describe('a window measured from the account valued every day', () => {
  const rows = [
    day('2025-01-01', 0),
    day('2025-01-02', 10_000, 10_000),     // the account opens with a deposit
    day('2025-01-03', 11_000),             // +10%
    day('2025-01-04', 21_000, 10_000),     // another 10,000 paid in, market flat
    day('2025-01-05', 23_100),             // +10% on the larger balance
  ];

  test('the days compound, and deposits change the balance but never the percentage', () => {
    const r = periodReturnFromHistory(rows, null, '2025-01-05');
    assert.ok(near(r.returnPct, 21), `${r.returnPct}`);          // 1.1 × 1.1
    assert.ok(near(r.pnl, 3100), `${r.pnl}`);                     // 1,000 + 2,100 earned
    // The first 10,000 opened the account, so it is the starting balance rather
    // than money paid in during the window; only the second deposit counts.
    assert.equal(r.startValue, 10_000);
    assert.equal(r.paidIn, 10_000);
  });

  test('a window starts from the close before its first day', () => {
    const r = periodReturnFromHistory(rows, '2025-01-05', '2025-01-05');
    assert.ok(near(r.returnPct, 10), `${r.returnPct}`);
    assert.equal(r.startValue, 21_000);
    assert.ok(near(r.pnl, 2100));
  });

  test('a deposit inside the window is not a gain', () => {
    const r = periodReturnFromHistory(rows, '2025-01-04', '2025-01-04');
    assert.ok(near(r.returnPct, 0), `${r.returnPct}`);
    assert.ok(near(r.pnl, 0));
  });

  test('days before the account held anything are not a base to divide by', () => {
    // 2 January divides by the 0 of 1 January, which would be infinite.
    const r = periodReturnFromHistory(rows, '2025-01-01', '2025-01-02');
    assert.equal(r, null);
  });

  test('a window after the last day holds nothing to measure', () => {
    assert.equal(periodReturnFromHistory(rows, '2025-02-01', '2025-02-28'), null);
    assert.equal(periodReturnFromHistory([], null, '2025-02-28'), null);
  });
});

describe("all time from the broker's own yearly returns", () => {
  /** A year's statement, as far as this needs one: joined up, with a return. */
  const year = (y, twr, startNav, endNav) => statementRecord({
    periodStart: `${y}-01-01`,
    periodEnd: `${y}-12-31`,
    twr,
    positions: [],
    closed: [],
    flows: [],
    openingHoldings: {},
    navChange: { startNav, endNav },
  });

  // The real account: −2.43% in 2024, +20.36% in 2025, +30.44% this year.
  const records = () => withStatements([], [
    year(2024, -2.43, 0, 15_103.8),
    year(2025, 20.36, 15_103.8, 26_365.95),
    year(2026, 30.444233794, 26_365.95, 45_743.38),
  ]);

  test('the years compound to what IBKR reports', () => {
    const r = chainedBrokerReturn(records(), 30.444233794, 2026);
    assert.ok(near(r, 53.1878, 0.001), `${r}`);
  });

  test("this year's figure is taken chained to today, not where its statement stopped", () => {
    const r = chainedBrokerReturn(records(), 32, 2026);
    assert.ok(near(r, ((1 - 0.0243) * 1.2036 * 1.32 - 1) * 100));
  });

  test('a missing year leaves a stretch the broker never measured, so there is no figure', () => {
    const gap = withStatements([], [year(2024, -2.43, 0, 15_103.8), year(2026, 30.44, 26_365.95, 45_743.38)]);
    assert.equal(chainedBrokerReturn(gap, 30.44, 2026), null);
  });

  test('so do statements that stop before this year', () => {
    const old = withStatements([], [year(2024, -2.43, 0, 15_103.8), year(2025, 20.36, 15_103.8, 26_365.95)]);
    assert.equal(chainedBrokerReturn(old, 20.36, 2026), null);
  });

  test('and a year with no return in it', () => {
    const missing = records();
    missing[1] = { ...missing[1], twr: null };
    assert.equal(chainedBrokerReturn(missing, 30.44, 2026), null);
  });

  test('another broker\'s history states no returns, so it is measured day by day instead', () => {
    const other = [{ kind: 'transactions', year: 2026, from: '2026-01-02', to: '2026-09-11', transactions: [] }];
    assert.equal(chainedBrokerReturn(other, 10, 2026), null);
  });
});

/**
 * All time: the account against everything paid into it.
 *
 * Asked for in those words — take every deposit and set it against what the
 * account is worth now. Checked on the two real accounts this app was built
 * around: an IBKR account with $30,508.51 paid in and $45,648.87 today reads
 * +49.63%; a bank history with $20,075 in and $1,175 out, worth $21,694.42,
 * reads +14.79%.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { allTimeFromDeposits } from '../src/core/portfolioHistory.js';

const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;

describe('all time from deposits', () => {
  test('profit is today\'s value less what was paid in, and the return is that over what was paid in', () => {
    const r = allTimeFromDeposits([{ date: '2024-11-19', amount: 30_508.51 }], 45_648.87);
    assert.ok(near(r.pnl, 15_140.36), `${r.pnl}`);
    assert.ok(near(r.returnPct, 49.63), `${r.returnPct}`);
    assert.equal(r.method, 'deposits');
  });

  test('withdrawals come off what was paid in', () => {
    const flows = [
      { date: '2025-03-06', amount: 20_075 },
      { date: '2026-03-13', amount: -1000 },
      { date: '2026-03-30', amount: -175 },
    ];
    const r = allTimeFromDeposits(flows, 21_694.42);
    assert.equal(r.paidIn, 18_900);
    assert.ok(near(r.pnl, 2794.42));
    assert.ok(near(r.returnPct, 14.79), `${r.returnPct}`);
  });

  test('when to say nothing: no deposits, or no account to measure', () => {
    assert.equal(allTimeFromDeposits([], 10_000), null);
    assert.equal(allTimeFromDeposits(undefined, 10_000), null);
    // No file for this year yet: the book is empty, and −100% would be wrong.
    assert.equal(allTimeFromDeposits([{ date: '2025-01-02', amount: 5000 }], 0), null);
    // More taken out than put in leaves nothing to divide by.
    assert.equal(allTimeFromDeposits([{ date: '2025-01-02', amount: 1000 }, { date: '2025-06-02', amount: -1500 }], 800), null);
  });
});

/**
 * Year to date on a history with no broker figure.
 *
 * Reported on a real bank history: the app said +88% for 2026. The account
 * opened the year worth about $2,845, took in $16,350 of deposits over the year
 * and made about $2,500 — and the year was reported as that profit over the
 * opening balance, as though the small January account had earned it all.
 * Valued day by day with the deposits taken out, the year made +20.9%.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { yearToDateReturn } from '../src/core/portfolioHistory.js';

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const day = (date, totalAccountValue, externalCashFlow = 0) => ({ date, totalAccountValue, externalCashFlow });

// $1,000 at the turn of the year, flat for a while, then $9,000 paid in and 10% made on all of it.
const rows = [
  day('2025-12-31', 1000),
  day('2026-01-02', 1000),
  day('2026-06-01', 10000, 9000),
  day('2026-09-11', 11000),
];

describe('year to date without a broker figure', () => {
  test('is the days compounded, not the year\'s profit over the January balance', () => {
    const r = yearToDateReturn({ method: 'trades', returnPct: 100, pnl: 1000 }, rows, '2026-01-01', '2026-09-11');
    assert.equal(r.method, 'history');
    // $1,000 profit over a $1,000 January account would say +100%; the money only ever made 10%.
    assert.ok(near(r.returnPct, 10), `${r.returnPct}`);
    assert.ok(near(r.pnl, 1000), `${r.pnl}`);
  });

  test('waits when there are no daily values to measure', () => {
    assert.equal(yearToDateReturn({ method: 'trades', returnPct: 88 }, [], '2026-01-01', '2026-09-11'), null);
  });
});

test("the broker's own figure, when a statement carries one, is kept as it is", () => {
  const broker = { method: 'broker', returnPct: 30.44, pnl: 12_000 };
  assert.equal(yearToDateReturn(broker, rows, '2026-01-01', '2026-09-11'), broker);
});

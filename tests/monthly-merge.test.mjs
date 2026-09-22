/**
 * Sales of one holding shown as one trade on the Monthly page.
 *
 * September 2026 listed four ETHA rows — 140 shares sold on the 18th in two
 * goes and more on the 21st — all from the holding bought 2025-01-10. They are
 * one position being got out of, so they become one row whose breakdown lists
 * each sale. Figures are from the real IBKR statement.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { mergedTrades } from '../src/ui/views/monthly.js';
import { realized, costOf, pctD } from '../src/core/portfolio.js';

// A sale as a statement records it: a result, with the cost as its entry.
const sale = (cost, proceeds, close, extra = {}) => ({
  ticker: 'ETHA', dir: 'Long', status: 'Closed', qty: 1, origQty: 1,
  entry: cost, cur: proceeds, amount: cost, open: '2025-01-10', close,
  summary: true, exits: [{ d: close, qty: 1, price: proceeds, pnl: proceeds - cost, pct: 100 }], ...extra,
});

const september = [
  sale(428.00, 723.13, '2026-09-21'),
  sale(812.04, 1043.00, '2026-09-21'),
  sale(2459.33, 1991.44, '2026-09-18'),
  sale(895.00, 796.58, '2026-09-18'),
  sale(3474.72, 3604.17, '2026-09-14', { ticker: 'COIN', open: '2026-01-16' }),
  sale(1658.00, 1870.96, '2026-09-08', { ticker: 'META', open: '2026-08-18' }),
];

describe('one holding, one row', () => {
  test('four ETHA sales become a single trade with four exits', () => {
    const rows = mergedTrades(september);
    assert.equal(rows.length, 3, 'ETHA merged, COIN and META untouched');
    const etha = rows.find((r) => r.ticker === 'ETHA');
    assert.equal(etha.partCount, 4);
    assert.equal(etha.exits.length, 4);
  });

  test('the month keeps its money: nothing invented, nothing lost', () => {
    const rows = mergedTrades(september);
    const before = september.reduce((s, p) => s + realized(p), 0);
    const after = rows.reduce((s, p) => s + realized(p), 0);
    assert.ok(Math.abs(after - before) < 1e-9, `${after} vs ${before}`);
    const costBefore = september.reduce((s, p) => s + costOf(p), 0);
    assert.ok(Math.abs(rows.reduce((s, p) => s + costOf(p), 0) - costBefore) < 1e-9);
  });

  test("the merged row's own figures: -$40.22 on $4,594.37 invested", () => {
    const etha = mergedTrades(september).find((r) => r.ticker === 'ETHA');
    assert.ok(Math.abs(costOf(etha) - 4594.37) < 1e-9);
    assert.ok(Math.abs(realized(etha) - -40.22) < 1e-9);
    assert.ok(Math.abs(pctD(realized(etha), costOf(etha)) - -0.8754) < 1e-3);
  });

  test('each slice keeps its own result, and the shares add to 100%', () => {
    const etha = mergedTrades(september).find((r) => r.ticker === 'ETHA');
    const pnls = etha.exits.map((e) => +e.pnl.toFixed(2)).sort((a, b) => a - b);
    assert.deepEqual(pnls, [-467.89, -98.42, 230.96, 295.13]);
    assert.ok(Math.abs(etha.exits.reduce((s, e) => s + e.pct, 0) - 100) < 1e-9);
  });

  test('it is filed under the last sale, and says which one it started from', () => {
    const etha = mergedTrades(september).find((r) => r.ticker === 'ETHA');
    assert.equal(etha.close, '2026-09-21');
    assert.equal(etha.firstExit, '2026-09-18');
  });

  test('an earlier round trip in the same stock stays its own row', () => {
    const older = sale(300, 500, '2026-09-02', { open: '2024-03-01' });
    const rows = mergedTrades([...september, older]);
    assert.equal(rows.length, 4);
    assert.equal(rows.filter((r) => r.ticker === 'ETHA').length, 2);
  });

  test('another account, or the other direction, never merges in', () => {
    const other = sale(100, 150, '2026-09-19', { account: 'b' });
    const short = sale(100, 150, '2026-09-19', { dir: 'Short' });
    const rows = mergedTrades([...september, other, short]);
    assert.equal(rows.filter((r) => r.ticker === 'ETHA').length, 3);
  });

  test('a lone sale is left exactly as it was', () => {
    const [only] = mergedTrades([september[4]]);
    assert.equal(only, september[4]);
  });
});

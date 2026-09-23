/**
 * Taking money out must not look like losing it.
 *
 * Withdrawing $3,000 from a $10,000 account left the year to date reading
 * −30% on a day nothing happened: the value fell and there was nothing on
 * record to explain it, so the app booked it as a loss. The same blindness put
 * the all-time-high star out of reach — measured on value, the account has to
 * earn back the withdrawn money before it can ever set a new high.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { periodReturnFromHistory } from '../src/core/portfolioHistory.js';
import { allTimeHigh } from '../src/core/snapshots.js';

const day = (date, totalAccountValue, externalCashFlow = 0) => ({ date, totalAccountValue, externalCashFlow });

describe('year to date ignores money moving in or out', () => {
  // Flat all year, then $3,000 taken out on the last day.
  const withdrew = [
    day('2026-01-01', 10_000), day('2026-06-01', 10_000), day('2026-06-02', 7_000, -3_000),
  ];
  const stayed = [day('2026-01-01', 10_000), day('2026-06-01', 10_000), day('2026-06-02', 10_000)];

  test('a flat year that ends in a withdrawal is still flat', () => {
    const r = periodReturnFromHistory(withdrew, '2026-01-01', '2026-12-31');
    assert.ok(Math.abs(r.returnPct) < 1e-9, `got ${r.returnPct}%`);
  });

  test('it reads the same as if the money had never left', () => {
    const a = periodReturnFromHistory(withdrew, '2026-01-01', '2026-12-31');
    const b = periodReturnFromHistory(stayed, '2026-01-01', '2026-12-31');
    assert.ok(Math.abs(a.returnPct - b.returnPct) < 1e-9);
  });

  test('a withdrawal is not profit either: the P&L stays zero', () => {
    const r = periodReturnFromHistory(withdrew, '2026-01-01', '2026-12-31');
    assert.ok(Math.abs(r.pnl) < 1e-9, `got ${r.pnl}`);
  });

  test('real gains still show, withdrawal or not', () => {
    // Up 10% to $11,000, then $3,000 out.
    const rows = [day('2026-01-01', 10_000), day('2026-06-01', 11_000), day('2026-06-02', 8_000, -3_000)];
    const r = periodReturnFromHistory(rows, '2026-01-01', '2026-12-31');
    assert.ok(Math.abs(r.returnPct - 10) < 1e-9, `got ${r.returnPct}%`);
  });

  test('paying money in is not a gain', () => {
    const rows = [day('2026-01-01', 10_000), day('2026-06-01', 10_000), day('2026-06-02', 15_000, 5_000)];
    const r = periodReturnFromHistory(rows, '2026-01-01', '2026-12-31');
    assert.ok(Math.abs(r.returnPct) < 1e-9, `got ${r.returnPct}%`);
  });
});

describe('the all-time high follows performance, not the size of the account', () => {
  test('a withdrawal does not put the high out of reach', () => {
    // $50,000, $20,000 withdrawn, then the remaining $30,000 grows to $33,000.
    const rows = [
      day('2026-01-01', 50_000), day('2026-02-01', 30_000, -20_000), day('2026-03-01', 33_000),
    ];
    const high = allTimeHigh(rows);
    assert.equal(high.date, '2026-03-01', 'the best performance is the last day, not the richest day');
    assert.ok(Math.abs(high.returnPct - 10) < 1e-9, `got ${high.returnPct}%`);
  });

  test('paying money in does not set a high on its own', () => {
    // Flat, then $40,000 deposited: much more money, nothing earned.
    const rows = [day('2026-01-01', 10_000), day('2026-02-01', 10_000), day('2026-03-01', 50_000, 40_000)];
    const high = allTimeHigh(rows);
    assert.ok(Math.abs(high.returnPct) < 1e-9, 'no gain, so no new high');
    assert.equal(high.date, '2026-01-01', 'the first day already stood at the best return');
  });

  test('it still marks a genuine peak, and keeps the value of that day', () => {
    const rows = [day('2026-01-01', 10_000), day('2026-02-01', 14_000), day('2026-03-01', 12_000)];
    const high = allTimeHigh(rows);
    assert.equal(high.date, '2026-02-01');
    assert.equal(high.value, 14_000);
    assert.ok(Math.abs(high.returnPct - 40) < 1e-9);
  });

  test('with no history there is nothing to mark', () => {
    assert.equal(allTimeHigh([]), null);
    assert.equal(allTimeHigh([day('2026-01-01', 0)]), null);
  });
});

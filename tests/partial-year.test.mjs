/**
 * A year whose file covers only part of it.
 *
 * Reported: after importing 2024, 2025 and 2026 the account chart was a flat
 * line and every return read 0%. The 2026 file was a daily statement covering
 * 15 September alone, so the history began that day with $45,193 already in the
 * account: year to date was measured over one day, and all time counted the
 * missing year's deposits as profit. Such a year is now named, and the figures
 * that cannot be measured say so instead of reading 0%.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { periodReturnFromHistory, yearToDateReturn } from '../src/core/portfolioHistory.js';
import { historyGaps, statementRecord } from '../src/features/statementLibrary.js';
import { transactionRecords } from '../src/features/transactionBook.js';

const year = (from, to) => statementRecord({ periodStart: from, periodEnd: to, positions: [], closed: [], flows: [], navChange: {} });
const day = (date, totalAccountValue, externalCashFlow = 0) => ({ date, totalAccountValue, externalCashFlow });

describe('which years leave a hole', () => {
  test('a daily statement for the newest year, after full earlier years, is named', () => {
    const gaps = historyGaps([year('2024-01-01', '2024-12-31'), year('2025-01-01', '2025-12-31'), year('2026-09-15', '2026-09-15')]);
    assert.deepEqual(gaps.map((g) => [g.year, g.from, g.startsLate, g.endsEarly]), [[2026, '2026-09-15', true, false]]);
  });

  test('a year to date for the newest year is whole', () => {
    assert.deepEqual(historyGaps([year('2025-01-01', '2025-12-31'), year('2026-01-01', '2026-09-14')]), []);
  });

  test('an earlier year that stops before December, with a later year after it, is named', () => {
    const gaps = historyGaps([year('2025-01-01', '2025-06-30'), year('2026-01-01', '2026-09-14')]);
    assert.deepEqual(gaps.map((g) => [g.year, g.endsEarly]), [[2025, true]]);
  });

  test('the oldest year may start late: that is when the account opened', () => {
    assert.deepEqual(historyGaps([year('2024-03-11', '2024-12-31'), year('2025-01-01', '2025-12-31')]), []);
  });

  test("another broker's histories start at their first transaction, and are not judged by it", () => {
    const records = transactionRecords([
      { date: '2025-03-06', at: '2025-03-06 10:00:00', order: 0, kind: 'deposit', cash: 500 },
      { date: '2026-02-01', at: '2026-02-01 10:00:00', order: 1, kind: 'deposit', cash: 500 },
    ]);
    assert.deepEqual(historyGaps(records), []);
  });
});

describe('a window reaching back past where the history begins', () => {
  // The history the daily statement gave: two days, already worth $45,193.
  const late = [day('2026-09-15', 45_192.91), day('2026-09-16', 45_192.91)];

  test('has no figure, rather than 0% over a day', () => {
    assert.equal(periodReturnFromHistory(late, '2026-01-01', '2026-09-16'), null);
    assert.equal(yearToDateReturn({ method: 'trades', returnPct: 3 }, late, '2026-01-01', '2026-09-16'), null);
  });

  test('a window inside the history is measured as before', () => {
    const rows = [day('2026-09-10', 100), day('2026-09-11', 110), day('2026-09-14', 121)];
    assert.ok(Math.abs(periodReturnFromHistory(rows, '2026-09-11', '2026-09-14').returnPct - 21) < 1e-9);
  });

  test('a new account whose history starts from nothing is measured from its first day', () => {
    const rows = [day('2026-03-02', 0), day('2026-03-03', 1000, 1000), day('2026-03-04', 1100)];
    assert.ok(Math.abs(periodReturnFromHistory(rows, '2026-01-01', '2026-03-04').returnPct - 10) < 1e-9);
  });
});

describe('a window over the missing part of a year', () => {
  const gaps = historyGaps([year('2025-01-01', '2025-12-31'), year('2026-09-15', '2026-09-15')]);

  test('has no figure when it reaches into the missing months', async () => {
    const { gapInWindow } = await import('../src/features/statementLibrary.js');
    assert.equal(gapInWindow(gaps, '2026-08-15', '2026-09-15'), true);
    assert.equal(gapInWindow(gaps, '2025-09-15', '2026-09-15'), true);
  });

  test('is measured when it lies after the missing months or before the year', async () => {
    const { gapInWindow } = await import('../src/features/statementLibrary.js');
    assert.equal(gapInWindow(gaps, '2026-09-15', '2026-09-16'), false);
    assert.equal(gapInWindow(gaps, '2025-03-01', '2025-06-01'), false);
    assert.equal(gapInWindow([], '2026-01-01', '2026-09-16'), false);
  });
});

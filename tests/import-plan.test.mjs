/**
 * Uploading another broker's history into a journal that holds IBKR years.
 *
 * Reported as "it says error": an Israeli bank's 2025–2026 history, read
 * perfectly, could not be added to a journal already holding Interactive
 * Brokers statements for 2024–2026. The two 2025–2026 years were replaced but
 * 2024 stayed an IBKR year, the sources could not be joined, and the import
 * threw. Such files now replace the journal's imported years, and say so.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { importPlan, journalFromStatements, sourceOf } from '../src/features/statementLibrary.js';
import { transactionRecords } from '../src/features/transactionBook.js';

const ibkrYear = (year) => ({ kind: 'ibkr', year, from: `${year}-01-01`, to: `${year}-12-31` });

const bankHistory = () => transactionRecords([
  { date: '2025-03-06', at: '2025-03-06 00:00:00', order: 0, kind: 'deposit', cash: 500 },
  { date: '2025-03-06', at: '2025-03-06 00:00:01', order: 1, kind: 'buy', ticker: 'IVV', qty: 0.5, price: 500, cash: -250 },
  { date: '2026-01-09', at: '2026-01-09 00:00:00', order: 2, kind: 'sell', ticker: 'IVV', qty: 0.5, price: 600, cash: 300 },
], { source: 'bank.csv' });

describe('files from a different source than the journal', () => {
  /**
   * Reported later: adding one year's file removed every other year. A file of
   * the other kind used to replace the whole journal without being asked. It is
   * now turned away, and the years already imported stay exactly as they are.
   */
  test('are refused, and replace nothing', () => {
    const existing = [ibkrYear(2024), ibkrYear(2025), ibkrYear(2026)];
    const plan = importPlan(existing, bankHistory());
    assert.equal(plan.mixed, true);
    assert.equal(plan.mixedWith, 'journal');
    assert.deepEqual(plan.replaced, []);
    assert.equal(plan.replacedSource, 'ibkr');
  });

  test('replace the journal only when that is explicitly asked for', () => {
    const plan = importPlan([ibkrYear(2024), ibkrYear(2025), ibkrYear(2026)], bankHistory(), { replace: true });
    assert.deepEqual(plan.replaced, [2024, 2025, 2026]);
    const journal = journalFromStatements(plan.records, {});
    assert.ok(Math.abs(journal.cash - 550) < 1e-9, `${journal.cash}`);
  });
});

test('adding a year leaves every other year exactly as it was', () => {
  const existing = transactionRecords([
    { date: '2024-05-01', at: '2024-05-01 00:00:00', order: 0, kind: 'deposit', cash: 100 },
  ], { source: 'old.csv' });
  const onlyThisYear = bankHistory().filter((r) => r.year === 2026);
  const plan = importPlan(existing, onlyThisYear);
  assert.equal(plan.mixed, false);
  assert.deepEqual(plan.records.map((r) => r.year), [2024, 2026]);
  assert.equal(plan.records[0], existing[0], 'the 2024 record is the very same one, untouched');
});

describe('files from the same source as the journal', () => {
  test('are added, replacing only their own years', () => {
    const existing = transactionRecords([
      { date: '2024-05-01', at: '2024-05-01 00:00:00', order: 0, kind: 'deposit', cash: 100 },
    ], { source: 'old.csv' });
    const plan = importPlan(existing, bankHistory());
    assert.deepEqual(plan.replaced, []);
    assert.deepEqual(plan.records.map((r) => r.year), [2024, 2025, 2026]);
  });

  test('an empty journal takes them as they are', () => {
    const plan = importPlan([], bankHistory());
    assert.deepEqual(plan.replaced, []);
    assert.equal(plan.mixed, false);
  });
});

test('an IBKR statement and another broker\'s file in one upload still cannot go in together', () => {
  const plan = importPlan([], [ibkrYear(2024), ...bankHistory()]);
  assert.equal(plan.mixed, true);
});

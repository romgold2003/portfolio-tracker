/**
 * The statement is the source of truth, so the import is checked against it.
 *
 * Every bug in this area has had the same shape. Nothing throws, the page
 * renders, the figures look plausible — and the account is a few thousand
 * light. It is found weeks later, by eye, with no way to say when it started.
 *
 * So after a file is read and a journal built from it, the two are set side by
 * side: the cash the broker states, what it says the holdings are worth, what
 * was paid in, what the whole thing came to. Nothing here adjusts anything. An
 * import that quietly corrected itself to the broker's total would hide exactly
 * what this is for.
 *
 * The two failures below are the real ones, reproduced: cash read from one
 * account of two, and accrued dividends looked for under the wrong words.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { reconcileStatement, reconciliationLines, tolerance } from '../src/features/reconcile.js';

/** A statement's parsed shape, reduced to what reconciling reads. */
const parsed = (over = {}) => ({
  openingCash: 1000,
  openingHoldings: { VOO: 10 },
  openingMarks: { VOO: 500 },
  ledger: [{ cash: -2000 }],
  transfers: [],
  navReported: { cash: 4000, accruals: 5.07, positions: 8000, total: 12_005.07 },
  navChange: { startNav: 6000, endNav: 12_005.07, deposits: 5000, dividends: 0, interest: 0, tax: 0 },
  ...over,
});

/** The journal that a correct read of that statement produces. */
const journal = (over = {}) => ({
  cash: 4005.07,
  cashFlows: [{ date: '2026-02-01', amount: 5000 }],
  positions: [{ status: 'Open', dir: 'Long', cls: 'Stocks', ticker: 'VOO', qty: 10, entry: 700, cur: 800 }],
  ...over,
});

const by = (report, id) => report.checks.find((c) => c.id === id);

describe('a file that was read correctly', () => {
  const report = reconcileStatement(parsed(), journal());

  test('reconciles on every figure the statement states', () => {
    assert.equal(report.ok, true, JSON.stringify(report.failed));
    assert.equal(report.failed.length, 0);
    assert.equal(report.worst, null);
  });

  test('and checks the things worth checking', () => {
    assert.deepEqual(report.checks.map((c) => c.id).sort(),
      ['cash', 'deposits', 'ledger', 'nav', 'opening', 'positions']);
  });

  test('the cash check counts accruals with cash, as the broker does', () => {
    assert.equal(by(report, 'cash').reported, 4005.07);
  });

  test('and says so in one line rather than six', () => {
    const lines = reconciliationLines(report);
    assert.ok(lines.every((l) => l.includes('matches the statement')));
  });
});

describe('the failures this was built from', () => {
  test("one account's cash against two accounts' holdings", () => {
    // The real shape: $4,900.96 of a second account's cash never read.
    const report = reconcileStatement(parsed(), journal({ cash: 4005.07 - 4900.96 }));
    assert.equal(report.ok, false);
    assert.equal(report.worst.id, 'cash');
    assert.ok(Math.abs(report.worst.diff + 4900.96) < 1e-9);
    // The net asset value is wrong by the same amount, which is the tell.
    assert.ok(!by(report, 'nav').ok);
  });

  test('accrued dividends dropped, because the words were the other way round', () => {
    const report = reconcileStatement(parsed(), journal({ cash: 4000 }));
    assert.equal(report.ok, false);
    assert.ok(Math.abs(by(report, 'cash').diff + 5.07) < 1e-9);
  });

  test('a holding missed entirely', () => {
    const report = reconcileStatement(parsed(), journal({ positions: [] }));
    assert.equal(report.ok, false);
    assert.equal(by(report, 'positions').rebuilt, 0);
    assert.equal(by(report, 'positions').reported, 8000);
  });

  test('a deposit read as the wrong sign', () => {
    const report = reconcileStatement(parsed(), journal({ cashFlows: [{ date: '2026-02-01', amount: -5000 }] }));
    assert.equal(report.ok, false);
    assert.ok(Math.abs(by(report, 'deposits').diff + 10_000) < 1e-9, 'out by twice the deposit');
  });

  test('a trade whose cash was misread shows in the rebuilt balance', () => {
    // The ledger check is the only one that exercises every movement.
    const report = reconcileStatement(parsed({ ledger: [{ cash: -2500 }] }), journal());
    assert.equal(by(report, 'ledger').ok, false);
    assert.ok(Math.abs(by(report, 'ledger').diff + 500) < 1e-9);
  });

  test('and the report names both figures, never just that something is wrong', () => {
    const report = reconcileStatement(parsed(), journal({ cash: 100 }));
    const line = reconciliationLines(report).find((l) => l.includes('not rounding'));
    assert.match(line, /the statement says \$4,005\.07, this reads \$100\.00/);
  });
});

describe('what counts as the same number', () => {
  test('a few cents on a large account is rounding, not a discrepancy', () => {
    const report = reconcileStatement(parsed(), journal({ cash: 4005.11 }));
    assert.equal(by(report, 'cash').ok, true, 'four cents');
  });

  test('but a dollar is not', () => {
    const report = reconcileStatement(parsed(), journal({ cash: 4006.07 }));
    assert.equal(by(report, 'cash').ok, false);
  });

  test('the allowance grows with the size of the figure, slowly', () => {
    assert.equal(tolerance(0), 0.05);
    assert.equal(tolerance(50_000), 0.05);
    assert.ok(tolerance(10_000_000) > 0.05, 'a ten-million account may round further');
  });
});

describe('a file that states no totals', () => {
  test("is not called reconciled — there was nothing to check", () => {
    const report = reconcileStatement({ navChange: {} }, journal());
    assert.equal(report, null);
  });

  test('and says so rather than implying it passed', () => {
    const lines = reconciliationLines(null);
    assert.match(lines[0], /nothing to check it against/);
  });

  test('a figure the file omits is skipped, not counted as zero', () => {
    const report = reconcileStatement(parsed({ navChange: { endNav: 12_005.07 } }), journal());
    assert.equal(by(report, 'deposits'), undefined, 'no deposits stated, so no deposits check');
    assert.ok(by(report, 'nav'));
  });
});

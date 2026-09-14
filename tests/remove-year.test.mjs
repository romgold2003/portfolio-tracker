/**
 * Removing imported years.
 *
 * Reported: with every file removed, positions the person never had were still
 * on screen. Removing the last imported year kept the book exactly as it stood,
 * so whatever the last file had built stayed, belonging to no file at all.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { journalWithoutYear } from '../src/features/statementLibrary.js';
import { transactionRecords } from '../src/features/transactionBook.js';

const tx = (date, kind, extra) => ({ date, at: `${date} 00:00:00`, order: 0, kind, ...extra });

const twoYears = () => transactionRecords([
  tx('2025-03-06', 'deposit', { cash: 1000 }),
  tx('2025-03-07', 'buy', { ticker: 'IVV', qty: 1, price: 500, cash: -500 }),
  tx('2026-01-09', 'deposit', { cash: 300 }),
  tx('2026-01-10', 'buy', { ticker: 'OKLO', qty: 10, price: 40, cash: -400 }),
]);

const current = (statements) => ({
  statements,
  positions: [{ ticker: 'OKLO', status: 'Open' }, { ticker: 'IVV', status: 'Open' }],
  cash: 400,
  snapshots: [{ date: '2026-09-01', value: 900 }],
  cashFlows: [{ date: '2026-01-09', amount: 300 }],
  apiKey: 'finnhub-key',
});

describe('removing the last imported year', () => {
  test('removes every position, trade, cash balance, deposit and daily value with it', () => {
    const [only] = twoYears();
    const left = journalWithoutYear(current([only]), only.year);
    assert.deepEqual(left.positions, []);
    assert.equal(left.cash, 0);
    assert.deepEqual(left.cashFlows, []);
    assert.deepEqual(left.snapshots, []);
    assert.deepEqual(left.statements, []);
    assert.equal(left.ledger, null);
    assert.equal(left.openingNav, null);
  });

  test('keeps the API key, which belongs to no account', () => {
    const [only] = twoYears();
    assert.equal(journalWithoutYear(current([only]), only.year).apiKey, 'finnhub-key');
  });
});

describe('removing a year while others remain', () => {
  test('rebuilds the book from the years left alone', () => {
    const years = twoYears();
    const left = journalWithoutYear(current(years), 2026);
    assert.deepEqual(left.statements.map((r) => r.year), [2025]);
    assert.deepEqual(left.positions.filter((p) => p.status === 'Open').map((p) => p.ticker), ['IVV']);
    assert.ok(Math.abs(left.cash - 500) < 1e-9, `${left.cash}`);
  });
});

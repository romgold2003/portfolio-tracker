/**
 * Erasing the journal: the account stays, everything it recorded goes.
 *
 * The only way to start an account over used to be deleting it and registering
 * again, which loses the password, the name and every setting with it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { emptyJournal, journalWithoutYear } from '../src/features/statementLibrary.js';

describe('an emptied journal', () => {
  const full = {
    positions: [{ ticker: 'AAA', status: 'Open', qty: 10 }, { ticker: 'BBB', status: 'Closed', qty: 5 }],
    cash: 4200,
    snapshots: [{ date: '2026-01-01', value: 1000 }],
    cashFlows: [{ date: '2026-01-01', amount: 10000 }],
    income: { dividends: 12, interest: 3, commissions: 4, tax: 0 },
    openingNav: 9000,
    ledger: { events: [{ kind: 'trade' }] },
    statements: [{ year: 2026 }],
    apiKey: 'my-key',
  };

  test('holds nothing at all', () => {
    const after = emptyJournal(full);
    assert.deepEqual(after.positions, []);
    assert.equal(after.cash, 0);
    assert.deepEqual(after.snapshots, []);
    assert.deepEqual(after.cashFlows, []);
    assert.deepEqual(after.statements, []);
    assert.equal(after.income, null);
    assert.equal(after.openingNav, null);
    assert.equal(after.ledger, null);
  });

  test('keeps the API key, which is a setting rather than a record', () => {
    assert.equal(emptyJournal(full).apiKey, 'my-key');
    assert.equal(emptyJournal({}).apiKey, '');
    assert.equal(emptyJournal().apiKey, '');
  });

  test('is the same journal removing the last imported year leaves', () => {
    const afterRemoval = journalWithoutYear({ statements: [{ year: 2026 }], apiKey: 'my-key' }, 2026);
    assert.deepEqual(afterRemoval, emptyJournal(full));
  });

  test('carries the short-cash model, so nothing is corrected on load', () => {
    assert.equal(emptyJournal(full).cashModel, 2);
  });
});

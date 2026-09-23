/**
 * Removing a year with the × on its square.
 *
 * It did nothing at all for some people: rebuilding the journal threw on a
 * record that was missing a list it was read straight from, and because the
 * throw was never caught, the year stayed with no dialog and no message. A
 * statement with no closed trades is an ordinary thing, and a record that
 * cannot say is now treated the same way rather than crashing the rebuild.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { statementToJournal } from '../src/features/ibkr.js';
import { journalWithoutYear, withoutStatement } from '../src/features/statementLibrary.js';

const record = (year, extra = {}) => ({
  kind: 'ibkr',
  year,
  from: `${year}-01-01`,
  to: `${year}-12-31`,
  positions: [],
  closed: [],
  cash: 0,
  ...extra,
});

describe('a statement missing a list does not crash the rebuild', () => {
  test('no closed trades at all', () => {
    const journal = statementToJournal({ positions: [], cash: 100 });
    assert.deepEqual(journal.positions, []);
  });

  test('no positions either', () => {
    const journal = statementToJournal({ cash: 100 });
    assert.deepEqual(journal.positions, []);
  });

  test('a list that is not a list is read as none, not as a crash', () => {
    const journal = statementToJournal({ positions: null, closed: 'nonsense', cash: 0 });
    assert.deepEqual(journal.positions, []);
  });
});

describe('removing a year', () => {
  test('leaves the years that were not removed', () => {
    const left = withoutStatement([record(2024), record(2025), record(2026)], 2025);
    assert.deepEqual(left.map((r) => r.year), [2024, 2026]);
  });

  test('rebuilds from the years left, even when one is missing its lists', () => {
    const journal = { statements: [record(2025, { closed: undefined }), record(2026)], apiKey: 'k', snapshots: [] };
    const after = journalWithoutYear(journal, 2026);
    assert.deepEqual(after.statements.map((r) => r.year), [2025]);
    assert.equal(after.apiKey, 'k');
  });

  test('removing the last year empties the book but keeps the key', () => {
    const journal = { statements: [record(2026)], apiKey: 'k', snapshots: [] };
    const after = journalWithoutYear(journal, 2026);
    assert.deepEqual(after.statements, []);
    assert.deepEqual(after.positions, []);
    assert.equal(after.cash, 0);
    assert.equal(after.apiKey, 'k');
  });
});

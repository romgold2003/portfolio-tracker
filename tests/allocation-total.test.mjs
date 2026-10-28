/**
 * The allocation pie adds up to the account value (October 2026).
 *
 * It counted a short at its absolute size, so beside a $45,058 account it
 * read $47,515 — longs plus shorts plus cash, twice the $1,228 short apart.
 * Romy saw the two numbers side by side and asked why they differed. Each
 * sector is now what it adds to the account, longs less shorts.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { sectorBreakdown, accountTotals } from '../src/core/portfolio.js';

const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;
const sum = (rows, f) => rows.reduce((s, r) => s + f(r), 0);
const pos = (over) => ({ status: 'Open', dir: 'Long', qty: 10, cur: 100, entry: 90, sector: 'Technology', ...over });

describe('the pie and the account value', () => {
  test('with a short: the sectors and cash add up to the account value', () => {
    const positions = [
      pos({ ticker: 'NVDA', qty: 10, cur: 200 }),
      pos({ ticker: 'AMD', qty: 5, cur: 100 }),
      pos({ ticker: 'JPM', qty: 4, cur: 300, sector: 'Financials' }),
      pos({ ticker: 'TSLA', dir: 'Short', qty: 2, cur: 400, sector: 'Consumer Discretionary' }),
    ];
    const cash = 1000;
    const rows = sectorBreakdown(positions, cash);
    const account = accountTotals(positions, cash).account;
    assert.equal(account, 2000 + 500 + 1200 - 800 + 1000);
    assert.ok(near(sum(rows, (r) => r.value), account), `${sum(rows, (r) => r.value)} vs ${account}`);
    assert.ok(near(sum(rows, (r) => r.pct), 100));
  });

  test('a sector net short has no wedge, and stays in the list, negative', () => {
    const rows = sectorBreakdown([pos({ ticker: 'NVDA' }), pos({ ticker: 'TSLA', dir: 'Short', qty: 1, cur: 400, sector: 'Consumer Discretionary' })], 500);
    const short = rows.find((r) => r.holdings.includes('TSLA'));
    assert.equal(short.value, -400);
    assert.equal(short.wedge, 0);
    assert.ok(rows.every((r) => r.wedge >= 0));
  });

  test('cash borrowed counts against the account, as it does in the account value', () => {
    const positions = [pos({ ticker: 'NVDA' })];
    const rows = sectorBreakdown(positions, -250);
    assert.equal(rows.find((r) => r.isCash).value, -250);
    assert.ok(near(sum(rows, (r) => r.value), accountTotals(positions, -250).account));
  });

  test('both charts draw the wedge, never a negative slice', () => {
    for (const file of ['../src/ui/charts.js', '../src/ui/views/allocationOverlay.js']) {
      assert.match(readFileSync(new URL(file, import.meta.url), 'utf8'), /data: rows\.map\(\(r\) => r\.wedge \?\? r\.value\)/, file);
    }
  });
});

const csv = ['C:/Users/User/OneDrive - Reichman University/Desktop/MULTI_20260101_20261014.csv', 'C:/Users/User/Downloads/MULTI_20260101_20261014.csv']
  .find((f) => existsSync(f));

test('the real book on 14 October 2026, short included: pie total = account value', { skip: !csv }, async () => {
  const { parseIbkrStatement, statementToJournal } = await import('../src/features/ibkr.js');
  const journal = statementToJournal(parseIbkrStatement(readFileSync(csv, 'utf8')));
  const open = journal.positions.filter((p) => p.status === 'Open');
  assert.ok(open.some((p) => p.dir === 'Short'), 'the book holds a short');
  const rows = sectorBreakdown(journal.positions, journal.cash);
  const account = accountTotals(journal.positions, journal.cash).account;
  assert.ok(near(sum(rows, (r) => r.value), account, 0.01), `pie ${sum(rows, (r) => r.value)} vs account ${account}`);
  // What the pie used to read: longs plus shorts plus cash.
  const before = sum(open, (p) => Math.abs(p.cur * p.qty)) + journal.cash;
  assert.ok(before - account > 2000, `the old total was ${before.toFixed(2)}, ${(before - account).toFixed(2)} over`);
});

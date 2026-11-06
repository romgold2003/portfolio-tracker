/**
 * The S&P 500 beside "You" counts its dividends (November 2026 audit): the
 * account's return includes the dividends it was paid, so the index has to as
 * well, or every account looks about a point and a quarter better a year than
 * it is.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { benchmarkYearToDate, withDividends } = await import('../src/services/benchmark.js');

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test('a dividend on its ex-date is reinvested, so the drop it causes is not a loss', () => {
  // 100 at the end of the year; the price falls 2 on the ex-date because 2 was paid out, then rises 10%.
  const rows = [
    { date: '2025-12-31', close: 100 },
    { date: '2026-03-27', close: 98, div: 2 },
    { date: '2026-06-30', close: 107.8 },
  ];
  // Price alone: +7.8%. Reinvested: (98 + 2) / 100 × 107.8 / 98 = +10%.
  assert.ok(near(benchmarkYearToDate(rows, null, 2026), 10), `${benchmarkYearToDate(rows, null, 2026)}`);
  assert.ok(near(benchmarkYearToDate(rows.map(({ div, ...r }) => r), null, 2026), 7.8));
  assert.equal(withDividends(rows), true);
  assert.equal(withDividends(rows.map(({ div, ...r }) => r)), false);
});

test('a live price carries on from the last close', () => {
  const rows = [{ date: '2025-12-31', close: 100 }, { date: '2026-11-05', close: 110 }];
  assert.ok(near(benchmarkYearToDate(rows, 121, 2026), 21));
});

test('no close at the turn of the year, no figure', () => {
  assert.equal(benchmarkYearToDate([{ date: '2026-02-01', close: 100 }, { date: '2026-03-01', close: 101 }], null, 2026), null);
  assert.equal(benchmarkYearToDate([], null, 2026), null);
});

test('the server sends the dividends with the prices', () => {
  const api = readFileSync(new URL('../api/history.js', import.meta.url), 'utf8');
  assert.match(api, /events=split%7Cdiv/);
  assert.match(api, /JSON\.stringify\(\{ symbol, rows, splits, dividends \}\)/);
});

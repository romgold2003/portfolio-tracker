/**
 * Today's point in the daily history follows the live account (November
 * 2026): the 1W, 1M and 3M returns were measured to the value from when the
 * app was opened, so a pre-market or intraday move after that was missing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { setBackfill, refreshToday, authoritativeHistory } = await import('../src/core/snapshots.js');
const { periodReturnFromHistory } = await import('../src/core/portfolioHistory.js');

test('a price move after the history was built reaches the week’s return', () => {
  setBackfill([
    { date: '2026-11-14', totalAccountValue: 100000, externalCashFlow: 0 },
    { date: '2026-11-17', totalAccountValue: 98000, externalCashFlow: 0 },
    { date: '2026-11-19', totalAccountValue: 95000, externalCashFlow: 0 },
  ], { authoritative: true });
  const before = periodReturnFromHistory(authoritativeHistory(), '2026-11-15', '2026-11-19').returnPct;
  assert.equal(Math.round(before * 100) / 100, -5);

  // Pre-market: the account is worth more now than when the app was opened.
  assert.equal(refreshToday(97000, 1000, '2026-11-19'), true);
  const after = periodReturnFromHistory(authoritativeHistory(), '2026-11-15', '2026-11-19').returnPct;
  assert.equal(Math.round(after * 100) / 100, -3);
  assert.equal(refreshToday(97000, 1000, '2026-11-19'), false, 'nothing to change the second time');
  assert.equal(refreshToday(99000, 1000, '2026-11-20'), false, 'never writes a day that is not the last');
});

test('Home moves today’s point to the live value before drawing', () => {
  const home = readFileSync(new URL('../src/ui/views/home.js', import.meta.url), 'utf8');
  assert.match(home, /refreshToday\(totals\.account, state\.cash, todayStr\(\)\);\s*drawCurve\(\);/);
});

/**
 * Returns measured the way each broker measures them (November 2026).
 *
 * Interactive Brokers reports time-weighted returns; Fidelity, Vanguard and
 * Trading 212 report money-weighted ones. The two agree whenever no money
 * moved, and part when it did — so Riskbook measures each person's return the
 * way their own broker does.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { moneyWeightedReturn, moneyWeightedCurve } from '../src/core/moneyWeighted.js';
import { periodReturnFromHistory, dayGrowth } from '../src/core/portfolioHistory.js';
import { returnMethodOf, BROKERS } from '../src/config/brokers.js';

const day = (n) => new Date(Date.UTC(2026, 0, 1) + n * 86400000).toISOString().slice(0, 10);

/** A daily history from [value, flow] pairs, one per day from 1 January. */
const history = (points) => points.map(([value, flow = 0], n) => ({ date: day(n), totalAccountValue: value, externalCashFlow: flow }));

/** The year: $1,000 up 10% by the end of June, $1,000 paid in on 2 July, then flat. */
function depositMidYear() {
  const points = [];
  for (let n = 0; n <= 364; n++) {
    if (n < 182) points.push([1000 * (1 + (0.1 * n) / 181)]);
    else if (n === 182) points.push([2100, 1000]);
    else points.push([2100]);
  }
  return history(points);
}

describe('money-weighted', () => {
  test('with no money moved it is the same number as time-weighted', () => {
    const rows = history([[1000], [1010], [990], [1050], [1100]]);
    const mwr = moneyWeightedReturn(rows);
    const twr = periodReturnFromHistory(rows);
    assert.ok(Math.abs(mwr.returnPct - 10) < 1e-6);
    assert.ok(Math.abs(mwr.returnPct - twr.returnPct) < 1e-6);
    assert.equal(mwr.pnl, twr.pnl);
  });

  test('it is the one rate that grows the opening balance and every deposit into the closing balance', () => {
    const rows = depositMidYear();
    const { returnPct, pnl, paidIn } = moneyWeightedReturn(rows);
    const growth = 1 + returnPct / 100;
    const days = 364;
    const atDeposit = 182 - 0.5;
    const grown = 1000 * growth + 1000 * growth ** ((days - atDeposit) / days);
    assert.ok(Math.abs(grown - 2100) < 1e-6, `${grown}`);
    assert.equal(pnl, 100);
    assert.equal(paidIn, 1000);
  });

  test('a deposit before a flat half-year weighs the return down; time-weighted does not see it', () => {
    const rows = depositMidYear();
    const mwr = moneyWeightedReturn(rows).returnPct;
    const twr = periodReturnFromHistory(rows).returnPct;
    // $100 made on $1,000 for the first half and $2,000 for the second: about 6.7%, against 10% time-weighted.
    assert.ok(mwr > 6.5 && mwr < 6.9, `${mwr}`);
    assert.ok(twr > 9.9 && twr < 10.1, `${twr}`);
  });

  test('withdrawals too: the money taken out stops counting from the day it left', () => {
    const rows = history([[1000], [1050], [1100], [600, -500], [630], [660]]);
    const { returnPct } = moneyWeightedReturn(rows);
    const growth = 1 + returnPct / 100;
    const grown = 1000 * growth - 500 * growth ** ((5 - 2.5) / 5);
    assert.ok(Math.abs(grown - 660) < 1e-6, `${grown}`);
  });

  test('one day with money paid in reads as that day’s time-weighted return, to a hair', () => {
    const rows = history([[1000], [1520, 500]]);
    const mwr = moneyWeightedReturn(rows).returnPct;
    const twr = (dayGrowth(1000, 1520, 500) - 1) * 100;
    assert.ok(Math.abs(mwr - twr) < 0.01, `${mwr} vs ${twr}`);
  });

  test('the same windows as time-weighted: none before a history that already held money', () => {
    const rows = history([[1000], [1010]]);
    assert.equal(moneyWeightedReturn(rows, '2025-12-01'), null);
    assert.equal(periodReturnFromHistory(rows, '2025-12-01'), null);
    assert.equal(moneyWeightedReturn(history([[0], [0]])), null);
  });

  test('a new account from nothing: the first deposit is where it starts', () => {
    const rows = history([[0], [1000, 1000], [1100], [1210]]);
    const mwr = moneyWeightedReturn(rows);
    assert.ok(Math.abs(mwr.returnPct - 21) < 1e-6);
  });

  test('the % chart: each day the return from the first day to that one', () => {
    const rows = depositMidYear();
    const curve = moneyWeightedCurve(rows);
    assert.equal(curve.length, rows.length);
    assert.equal(curve[0].pct, 0);
    assert.ok(Math.abs(curve[curve.length - 1].pct - moneyWeightedReturn(rows).returnPct) < 1e-9);
  });
});

describe('which method, for whom', () => {
  test('each broker’s own way; time-weighted when it publishes none', () => {
    for (const id of ['fidelity', 'vanguard', 't212']) assert.equal(returnMethodOf(null, id), 'mwr', id);
    for (const id of ['ibkr', 'interactive-israel', 'schwab', 'leumi', 'other']) assert.equal(returnMethodOf(null, id), 'twr', id);
    // Robinhood's chart is Modified Dietz (its support article, checked November 2026).
    assert.equal(returnMethodOf(null, 'robinhood'), 'md');
    assert.equal(returnMethodOf(null, null), 'twr');
    assert.ok(BROKERS.every((b) => b.returns == null || ['mwr', 'twr', 'md'].includes(b.returns)));
  });

  test('a choice made in Settings wins over the broker', () => {
    assert.equal(returnMethodOf('twr', 'fidelity'), 'twr');
    assert.equal(returnMethodOf('mwr', 'ibkr'), 'mwr');
    assert.equal(returnMethodOf('junk', 'fidelity'), 'mwr');
  });
});

describe('Modified Dietz (Robinhood, and IBKR’s money-weighted toggle)', () => {
  test('profit over the average money in the account, each deposit weighted by the time it was there', async () => {
    const { modifiedDietzReturn } = await import('../src/core/moneyWeighted.js');
    // 10,000 for ten days; 10,000 more on day 5 (mid-day, so 5.5 of 10 days remain); ends at 21,000.
    const rows = Array.from({ length: 11 }, (_, i) => ({
      date: `2026-03-${String(i + 1).padStart(2, '0')}`,
      totalAccountValue: i < 5 ? 10_000 : i < 10 ? 20_000 : 21_000,
      externalCashFlow: i === 5 ? 10_000 : 0,
    }));
    const r = modifiedDietzReturn(rows);
    assert.ok(Math.abs(r.pnl - 1000) < 1e-9);
    assert.ok(Math.abs(r.returnPct - (1000 / (10_000 + 10_000 * 5.5 / 10)) * 100) < 1e-9, `${r.returnPct}`);
    // Without money moving it equals every other method.
    const flat = rows.map((x) => ({ ...x, externalCashFlow: 0, totalAccountValue: x.totalAccountValue === 21_000 ? 10_500 : 10_000 }));
    assert.ok(Math.abs(modifiedDietzReturn(flat).returnPct - 5) < 1e-9);
  });
});

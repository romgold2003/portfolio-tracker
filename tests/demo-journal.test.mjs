/**
 * The demo book has to survive the same rules a real one does.
 *
 * It is shown to people, which makes a wrong number in it worse than a wrong
 * number in a fixture: the one thing a demo cannot afford is for the account
 * total to disagree with the trades that are supposed to explain it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildDemoJournal, DEMO_TICKERS, FALLBACK_PRICES } from '../scripts/demo-journal.mjs';
import { state, loadState } from '../src/core/store.js';
import { accountTotals, realized, unreal, costOf } from '../src/core/portfolio.js';
import { sectorOf } from '../src/config/sectors.js';

const journal = buildDemoJournal({ prices: FALLBACK_PRICES, today: '2026-09-06' });
const near = (a, b, tol = 0.01) => Math.abs(a - b) < tol;

describe('the demo journal', () => {
  test('survives the sanitizer with every position intact', () => {
    loadState(journal);
    assert.equal(state.positions.length, journal.positions.length);
    assert.ok(state.positions.every((p) => Number.isFinite(p.entry * p.qty)));
  });

  test('the account total is the positions plus the cash, and nothing else', () => {
    loadState(journal);
    const totals = accountTotals(state.positions, state.cash);
    const byHand = totals.open.reduce((sum, p) => sum + p.cur * p.qty, 0) + state.cash;
    assert.ok(near(totals.account, byHand), `${totals.account} vs ${byHand}`);
    assert.ok(Number.isFinite(totals.account) && totals.account > 0);
  });

  test('the cash left over is what the deposits and the trades leave', () => {
    loadState(journal);
    const deposits = journal.cashFlows.reduce((sum, f) => sum + f.amount, 0);
    const staked = state.positions.filter((p) => p.status === 'Open')
      .reduce((sum, p) => sum + costOf(p), 0);
    const banked = state.positions.filter((p) => p.status === 'Closed')
      .reduce((sum, p) => sum + realized(p), 0);
    const { dividends, interest, commissions, tax } = journal.income;
    const expected = deposits - staked + banked + dividends + interest - commissions - tax;
    assert.ok(near(state.cash, expected, 0.05), `cash ${state.cash} vs ${expected}`);
    // A demo that opens on a negative balance looks like a bug, not a demo.
    assert.ok(state.cash > 0, `cash is ${state.cash}`);
  });

  test('every closed trade banks exactly what its exits banked', () => {
    loadState(journal);
    for (const p of state.positions.filter((x) => x.status === 'Closed')) {
      const fromExits = p.exits.reduce((sum, e) => sum + e.pnl, 0);
      assert.ok(near(realized(p), fromExits, 0.01),
        `${p.ticker}: realized ${realized(p)} vs exits ${fromExits}`);
    }
  });

  test('the scaled exit gives back every share it took', () => {
    loadState(journal);
    const scaled = state.positions.find((p) => p.exits && p.exits.length > 1);
    assert.ok(scaled, 'no multi-exit trade in the book');
    const sold = scaled.exits.reduce((sum, e) => sum + e.qty, 0);
    assert.ok(near(sold, scaled.origQty, 1e-6), `sold ${sold} of ${scaled.origQty}`);
  });

  test('the short profits when its price falls', () => {
    loadState(journal);
    const short = state.positions.find((p) => p.dir === 'Short');
    assert.ok(short, 'no short in the book');
    assert.ok(short.cur < short.entry);
    assert.ok(realized(short) > 0);
  });

  test('it wins and it loses, on both the open and the closed side', () => {
    loadState(journal);
    const totals = accountTotals(state.positions, state.cash);
    assert.ok(totals.wins >= 5, `only ${totals.wins} winners`);
    assert.ok(totals.losses >= 5, `only ${totals.losses} losers`);
    const open = totals.open;
    assert.ok(open.some((p) => unreal(p) > 0) && open.some((p) => unreal(p) < 0));
  });

  test('the open book spans at least eight sectors', () => {
    loadState(journal);
    const sectors = new Set(state.positions.filter((p) => p.status === 'Open').map(sectorOf));
    assert.ok(sectors.size >= 8, `only ${sectors.size}: ${[...sectors].join(', ')}`);
    assert.ok(sectors.has('Crypto') && sectors.has('Commodities'));
  });

  test('the open positions stand where they were designed to stand', () => {
    loadState(journal);
    // NVDA is the book's big winner and RIVN its big loser; if the entry solve
    // ever inverts, these are the two that say so.
    const pct = (t) => {
      const p = state.positions.find((x) => x.ticker === t);
      return (unreal(p) / costOf(p)) * 100;
    };
    assert.ok(near(pct('NVDA'), 62.4, 0.1), `NVDA at ${pct('NVDA')}`);
    assert.ok(near(pct('RIVN'), -33.7, 0.1), `RIVN at ${pct('RIVN')}`);
  });

  test('the equity curve ends on the account value, not near it', () => {
    loadState(journal);
    const { account } = accountTotals(state.positions, state.cash);
    const last = journal.snapshots[journal.snapshots.length - 1];
    assert.equal(last.date, '2026-09-04'); // the last weekday on or before today
    assert.ok(near(last.value, account, 0.05), `curve ends ${last.value}, account ${account}`);
    assert.ok(journal.snapshots.every((s) => s.value > 0));
    // Weekdays only: a flat Saturday reads as missing data.
    assert.ok(journal.snapshots.every((s) => {
      const d = new Date(`${s.date}T00:00:00Z`).getUTCDay();
      return d !== 0 && d !== 6;
    }));
  });

  test('it carries no API key, whatever it was seeded from', () => {
    assert.equal(journal.apiKey, '');
    assert.equal(journal.openingNav, null);
  });

  test('the same seed builds the same book', () => {
    const again = buildDemoJournal({ prices: FALLBACK_PRICES, today: '2026-09-06' });
    assert.deepEqual(again, journal);
  });

  test('a missing quote falls back rather than producing NaN', () => {
    const partial = buildDemoJournal({ prices: {}, today: '2026-09-06' });
    assert.ok(partial.positions.every((p) => Number.isFinite(p.entry) && Number.isFinite(p.cur)));
    assert.equal(DEMO_TICKERS.length, Object.keys(FALLBACK_PRICES).length);
  });
});

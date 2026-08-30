/**
 * The portfolio mathematics, checked against what each measure is supposed to
 * mean rather than against what the code currently returns.
 *
 * The one this was written for: beta was divided by invested capital instead of
 * by equity, so cash — which has a beta of zero and genuinely dampens how much
 * an account moves with the market — was left out of the denominator entirely.
 * A book holding 16% cash reported 0.97 where the answer was 0.82.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  costOf, curValOf, unreal, realized, posValue, accountTotals,
  portfolioBeta, betaFromReturns, closeMath, pctD, bookedPnl,
} from '../src/core/portfolio.js';

const long = (over = {}) => ({
  ticker: 'AAA', cls: 'Stocks', dir: 'Long', status: 'Open',
  entry: 100, cur: 100, qty: 10, ...over,
});

describe('beta', () => {
  test('cash belongs in the denominator', () => {
    // 80,000 of index at beta 1, 20,000 in cash. The account moves 0.8% when
    // the market moves 1%, because a fifth of it is not in the market.
    const open = [long({ ticker: 'SPY', entry: 100, cur: 100, qty: 800 })];
    const withCash = portfolioBeta(open, new Map([['SPY', 1]]), 100000);
    assert.ok(Math.abs(withCash.beta - 0.8) < 1e-9, `expected 0.8, got ${withCash.beta}`);
  });

  test('a fully invested book is unaffected by the change', () => {
    const open = [long({ ticker: 'SPY', entry: 100, cur: 100, qty: 800 })];
    const fully = portfolioBeta(open, new Map([['SPY', 1]]), 80000);
    assert.ok(Math.abs(fully.beta - 1) < 1e-9);
  });

  test('an all-cash account has no market sensitivity', () => {
    const open = [long({ ticker: 'SPY', entry: 100, cur: 100, qty: 1 })];
    const mostlyCash = portfolioBeta(open, new Map([['SPY', 1]]), 1000000);
    assert.ok(mostlyCash.beta < 0.001, 'an account that is 99.99% cash should be near zero beta');
  });

  test('a short reduces it, rather than adding to it', () => {
    const book = [
      long({ ticker: 'SPY', entry: 100, cur: 100, qty: 1000 }),
      long({ ticker: 'QQQ', dir: 'Short', entry: 100, cur: 100, qty: 500 }),
    ];
    const betas = new Map([['SPY', 1], ['QQQ', 1]]);
    const hedged = portfolioBeta(book, betas, 100000);
    // +100,000 long and -50,000 short against 100,000 of equity.
    assert.ok(Math.abs(hedged.beta - 0.5) < 1e-9, `expected 0.5, got ${hedged.beta}`);
  });

  test('a perfectly hedged book is beta zero, not beta two', () => {
    const book = [
      long({ ticker: 'SPY', entry: 100, cur: 100, qty: 1000 }),
      long({ ticker: 'QQQ', dir: 'Short', entry: 100, cur: 100, qty: 1000 }),
    ];
    const hedged = portfolioBeta(book, new Map([['SPY', 1], ['QQQ', 1]]), 100000);
    assert.ok(Math.abs(hedged.beta) < 1e-9, 'summing absolute exposures would have said 1.0');
  });

  test('reports how much of the account is sitting out', () => {
    const open = [long({ ticker: 'SPY', entry: 100, cur: 100, qty: 800 })];
    const { cashDragPct } = portfolioBeta(open, new Map([['SPY', 1]]), 100000);
    assert.ok(Math.abs(cashDragPct - 20) < 1e-9);
  });

  test('the regression itself is the slope of asset on market', () => {
    const market = Array.from({ length: 60 }, (_, i) => Math.sin(i) / 100);
    assert.ok(Math.abs(betaFromReturns(market.map((x) => x * 2), market) - 2) < 1e-9);
    assert.ok(Math.abs(betaFromReturns(market.map((x) => -x), market) + 1) < 1e-9);
    assert.ok(Math.abs(betaFromReturns(market, market) - 1) < 1e-9);
  });

  test('and refuses to answer from too little history', () => {
    const short = Array.from({ length: 10 }, (_, i) => i / 100);
    assert.equal(betaFromReturns(short, short), null, 'a beta from ten days is noise');
  });
});

describe('P&L, long and short', () => {
  test('a long makes money as the price rises', () => {
    const p = long({ entry: 100, cur: 130, qty: 10 });
    assert.equal(unreal(p), 300);
    assert.equal(pctD(unreal(p), costOf(p)), 30);
  });

  test('a short makes money as the price falls', () => {
    const p = long({ dir: 'Short', entry: 100, cur: 80, qty: 10 });
    assert.equal(unreal(p), 200);
    assert.equal(pctD(unreal(p), costOf(p)), 20);
  });

  test('a short loses as the price rises', () => {
    const p = long({ dir: 'Short', entry: 100, cur: 120, qty: 10 });
    assert.equal(unreal(p), -200);
  });

  test('closing maths agrees with holding maths', () => {
    const p = long({ entry: 100, cur: 130, qty: 10 });
    assert.equal(closeMath(p, 130, 10).pnl, unreal(p));
  });

  test('proceeds of a long sale are price times quantity', () => {
    assert.equal(closeMath(long({ entry: 100, qty: 10 }), 130, 10).proceeds, 1300);
  });
});

describe('the account identity', () => {
  test('net liquidation value is positions at market plus cash', () => {
    const positions = [
      long({ entry: 100, cur: 130, qty: 10 }),
      long({ ticker: 'BBB', entry: 50, cur: 40, qty: 20 }),
    ];
    const t = accountTotals(positions, 5000);
    // 1,300 + 800 + 5,000
    assert.equal(t.account, 7100);
    assert.equal(t.account, positions.reduce((s, p) => s + posValue(p), 0) + 5000);
  });

  test('realised profit is not added on top of the cash it already became', () => {
    const closedTrade = {
      ...long({ entry: 100, cur: 130, qty: 10 }), status: 'Closed', close: '2026-04-01',
    };
    // The 300 is in cash already; the account must not count it twice.
    const t = accountTotals([closedTrade], 1300);
    assert.equal(t.account, 1300);
    assert.equal(t.realised, 300);
  });

  test('unrealised counts only what is still held', () => {
    const t = accountTotals([
      long({ entry: 100, cur: 130, qty: 10 }),
      { ...long({ entry: 100, cur: 130, qty: 10 }), status: 'Closed', close: '2026-04-01' },
    ], 0);
    assert.equal(t.unrealised, 300, 'a closed trade has no unrealised P&L');
    assert.equal(t.realised, 300);
  });
});

describe('win rate', () => {
  const closed = (pnlPerShare) => ({
    ...long({ entry: 100, cur: 100 + pnlPerShare, qty: 10 }),
    status: 'Closed', close: '2026-04-01',
  });

  test('is wins over closed trades, ignoring anything still open', () => {
    const t = accountTotals([closed(30), closed(-10), closed(5), long()], 0);
    assert.equal(t.wins, 2);
    assert.equal(t.losses, 1);
    assert.equal(t.winRate, 67, 'two of three closed trades won');
  });

  test('is zero, not undefined, before anything has closed', () => {
    assert.equal(accountTotals([long()], 0).winRate, 0);
  });
});

describe('a partially closed position', () => {
  test('realised equals the sum of the exits that produced it', () => {
    // Two slices of a ten-share position, at different prices.
    const p = {
      ...long({ entry: 100, qty: 10 }),
      status: 'Closed',
      close: '2026-04-10',
      origQty: 10,
      qty: 10,
      // Quantity-weighted average exit: (120*4 + 130*6) / 10 = 126
      cur: 126,
      exits: [
        { d: '2026-04-01', qty: 4, price: 120, pnl: 80, pct: 40 },
        { d: '2026-04-10', qty: 6, price: 130, pnl: 180, pct: 60 },
      ],
    };
    assert.equal(bookedPnl(p), 260);
    assert.ok(
      Math.abs(realized(p) - bookedPnl(p)) < 1e-9,
      `realised ${realized(p)} should equal the exits' ${bookedPnl(p)}`,
    );
  });
});

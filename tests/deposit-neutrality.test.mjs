/**
 * A deposit is capital, not profit.
 *
 * It makes the account bigger and it makes nothing else bigger. Every figure on
 * screen is checked here against that one rule, on the demo book, by taking the
 * whole set of numbers twice — once as the book stands, once with money paid in
 * and nothing else changed — and demanding that only the account value and the
 * cash balance move.
 *
 * Written as a sweep rather than one test per figure on purpose: a new number
 * added to the page is exactly the kind of thing that quietly reintroduces this,
 * and a sweep catches what a list of known cases cannot.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildDemoJournal, FALLBACK_PRICES } from '../scripts/demo-journal.mjs';
import { state, loadState } from '../src/core/store.js';
import {
  accountTotals, accountPerformance, dailyPortfolioMove, periodPnl,
  monthlyAccountReturns, avgTradeReturn, realized, unreal,
} from '../src/core/portfolio.js';

const TODAY = '2026-09-06';
const journal = () => buildDemoJournal({ prices: FALLBACK_PRICES, today: TODAY });
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

/** Every figure the overview reports, as one object. */
function figures({ extraCash = 0, flows = [] } = {}) {
  loadState(journal());
  state.cash += extraCash;
  state.cashFlows = [...(state.cashFlows ?? []), ...flows];

  const totals = accountTotals(state.positions, state.cash);
  const from = '2026-01-01';

  const period = accountPerformance({
    positions: state.positions,
    account: totals.account,
    from,
    to: TODAY,
    flows: state.cashFlows,
    openingNav: state.openingNav,
    startPrices: new Map(),
  });

  const month = monthlyAccountReturns(
    state.positions, totals.account, state.cashFlows, TODAY,
  ).get('2026-08');

  return {
    account: totals.account,
    cash: state.cash,
    unrealised: totals.unrealised,
    realised: totals.realised,
    total: totals.total,
    invested: totals.invested,
    winRate: totals.winRate,
    positionsValue: totals.positionsValue,
    periodReturnPct: period.returnPct,
    dailyPct: dailyPortfolioMove(state.positions, totals.account, TODAY).percent,
    dailyDollars: dailyPortfolioMove(state.positions, totals.account, TODAY).dollars,
    monthPct: month?.pct ?? null,
    avgTrade: avgTradeReturn(state.positions.filter((p) => p.status === 'Closed')),
  };
}

/** What a deposit is allowed to move. */
const MAY_MOVE = new Set(['account', 'cash', 'positionsValue']);

describe('paying money in', () => {
  const DEPOSIT = 25_000;
  const flow = [{ date: '2026-08-14', amount: DEPOSIT }];

  test('raises the account by exactly what was paid in', () => {
    const before = figures();
    const after = figures({ extraCash: DEPOSIT, flows: flow });
    assert.ok(near(after.account - before.account, DEPOSIT), `${after.account - before.account}`);
    assert.ok(near(after.cash - before.cash, DEPOSIT));
  });

  test('moves nothing else at all', () => {
    const before = figures();
    const after = figures({ extraCash: DEPOSIT, flows: flow });
    for (const key of Object.keys(before)) {
      if (MAY_MOVE.has(key)) continue;
      assert.ok(near(before[key] ?? 0, after[key] ?? 0, 0.02),
        `${key} moved on a deposit: ${before[key]} -> ${after[key]}`);
    }
  });

  test('is not realised profit', () => {
    const before = figures();
    const after = figures({ extraCash: DEPOSIT, flows: flow });
    assert.equal(after.realised, before.realised);
  });

  test('is not unrealised profit', () => {
    const before = figures();
    const after = figures({ extraCash: DEPOSIT, flows: flow });
    assert.equal(after.unrealised, before.unrealised);
  });

  test('does not change the period return', () => {
    const before = figures();
    const after = figures({ extraCash: DEPOSIT, flows: flow });
    assert.ok(near(before.periodReturnPct, after.periodReturnPct, 0.02),
      `${before.periodReturnPct}% -> ${after.periodReturnPct}%`);
  });

  test('does not change the month it landed in', () => {
    const before = figures();
    const after = figures({ extraCash: DEPOSIT, flows: flow });
    assert.ok(near(before.monthPct ?? 0, after.monthPct ?? 0, 0.02),
      `${before.monthPct}% -> ${after.monthPct}%`);
  });

  test("does not change today's move", () => {
    const before = figures();
    const after = figures({ extraCash: DEPOSIT, flows: [{ date: TODAY, amount: DEPOSIT }] });
    assert.ok(near(before.dailyDollars, after.dailyDollars), 'the dollars moved');
    assert.ok(near(before.dailyPct, after.dailyPct, 0.02),
      `today's percentage moved: ${before.dailyPct}% -> ${after.dailyPct}%`);
  });
});

describe('taking money out', () => {
  const WITHDRAWAL = -12_000;
  const flow = [{ date: '2026-08-14', amount: WITHDRAWAL }];

  test('lowers the account and nothing else', () => {
    const before = figures();
    const after = figures({ extraCash: WITHDRAWAL, flows: flow });
    assert.ok(near(after.account - before.account, WITHDRAWAL));
    for (const key of Object.keys(before)) {
      if (MAY_MOVE.has(key)) continue;
      assert.ok(near(before[key] ?? 0, after[key] ?? 0, 0.05),
        `${key} moved on a withdrawal: ${before[key]} -> ${after[key]}`);
    }
  });

  test('is not a loss', () => {
    const before = figures();
    const after = figures({ extraCash: WITHDRAWAL, flows: flow });
    assert.ok(after.periodReturnPct >= before.periodReturnPct - 0.02,
      `taking money out read as a loss: ${before.periodReturnPct}% -> ${after.periodReturnPct}%`);
  });
});

describe('the rule holds however the money arrives', () => {
  const cases = [
    ['one large deposit', [{ date: '2026-03-02', amount: 40_000 }], 40_000],
    ['several small ones', [
      { date: '2026-02-01', amount: 3000 },
      { date: '2026-05-01', amount: 3000 },
      { date: '2026-07-01', amount: 3000 },
    ], 9000],
    ['a deposit and a withdrawal', [
      { date: '2026-04-01', amount: 10_000 },
      { date: '2026-06-01', amount: -4000 },
    ], 6000],
    ['money in the day after trading began', [{ date: '2026-01-07', amount: 5000 }], 5000],
  ];

  for (const [name, flows, net] of cases) {
    test(name, () => {
      const before = figures();
      const after = figures({ extraCash: net, flows });
      assert.ok(near(after.account - before.account, net));
      assert.ok(near(before.periodReturnPct, after.periodReturnPct, 0.05),
        `${name}: return moved ${before.periodReturnPct}% -> ${after.periodReturnPct}%`);
      assert.equal(after.realised, before.realised);
      assert.equal(after.unrealised, before.unrealised);
    });
  }
});

describe('the raw building blocks cannot see cash at all', () => {
  beforeEach(() => loadState(journal()));

  test('a position P&L is prices and quantities only', () => {
    // Nothing in either function reads cash or flows, and this is the guard
    // that keeps it that way.
    const before = state.positions.map((p) => (p.status === 'Closed' ? realized(p) : unreal(p)));
    state.cash += 100_000;
    state.cashFlows = [{ date: TODAY, amount: 100_000 }];
    const after = state.positions.map((p) => (p.status === 'Closed' ? realized(p) : unreal(p)));
    assert.deepEqual(after, before);
  });

  test('periodPnl counts the trades, never the balance', () => {
    const totals = accountTotals(state.positions, state.cash);
    const a = periodPnl(state.positions, totals.account, '2026-01-01');
    const b = periodPnl(state.positions, totals.account + 50_000, '2026-01-01');
    assert.equal(a.pnl, b.pnl, 'the P&L itself must not move with the balance');
  });
});

/**
 * The one boundary, stated rather than hidden.
 *
 * Neutrality is a promise about deposits into an account that is already
 * running, and that is the only promise it can be. An account funded from
 * nothing has no opening balance, so there is no base to measure a return
 * against except the money that founded it — every method that returns a finite
 * number for such an account must put that money in the base.
 *
 * The demo book is exactly this case: it opens with a $42,000 transfer on 5
 * January and places its first trade on the 6th. Treating that transfer as a
 * contribution and taking it out left a base of $289 of rounding residue, and
 * the year read 3,752%.
 *
 * So money paid in before the first trade is the account's starting capital.
 * Everything after it is a contribution and cannot move a percentage.
 */
describe('the money the account was built from', () => {
  test('stays in the base, so the year is a believable number', () => {
    const { periodReturnPct } = figures();
    assert.ok(periodReturnPct > 0 && periodReturnPct < 100,
      `the year came out at ${periodReturnPct}%`);
  });

  test('every later deposit is still out of it', () => {
    // The founding transfer is 2026-01-05 and the first trade 2026-01-06.
    const before = figures();
    const after = figures({
      extraCash: 30_000,
      flows: [{ date: '2026-01-07', amount: 30_000 }],
    });
    assert.ok(near(before.periodReturnPct, after.periodReturnPct, 0.02),
      `${before.periodReturnPct}% -> ${after.periodReturnPct}%`);
  });

  test('and the profit itself never included it', () => {
    // Whatever the base, the numerator is the trades and nothing else.
    const before = figures();
    const after = figures({ extraCash: 30_000, flows: [{ date: '2026-01-02', amount: 30_000 }] });
    assert.equal(after.realised, before.realised);
    assert.equal(after.unrealised, before.unrealised);
  });
});

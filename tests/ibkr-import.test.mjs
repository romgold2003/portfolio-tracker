/**
 * Reading a real Interactive Brokers Activity Statement.
 *
 * Checked against the figures IBKR states in its own summary sections, because
 * an importer that parses without error but disagrees with the broker is worse
 * than one that fails: the numbers look plausible and are wrong.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { parseIbkrStatement, statementToJournal, describeStatement } from '../src/features/ibkr.js';
import { state, loadState } from '../src/core/store.js';
import { accountTotals, accountPerformance, modifiedDietzReturn } from '../src/core/portfolio.js';

/**
 * The statement is personal, so it is not in the repository and these tests
 * no-op without it. Both places it is normally kept are tried — pointing at one
 * that had moved is how this whole file came to be passing while asserting
 * nothing.
 */
const FILES = [
  'C:/Users/User/OneDrive - Reichman University/Desktop/MULTI_20260101_20260828.csv',
  'C:/Users/User/Downloads/MULTI_20260101_20260828.csv',
];
const near = (a, b, tol = 0.01) => Math.abs(a - b) < tol;

/** What IBKR states about this account, from its own summary blocks. */
const IB = {
  openPositions: 14,
  marketValue: 36837.34,
  costBasis: 31143.248368,
  unrealised: 5694.091632,
  realised: 8033.35145251,
  cash: 8359.631138846,
  deposits: 8497,
  dividends: 64.06,
  commissions: -192.77227115,
  startNav: 26365.94901,
  endNav: 45202.041138846,
};

let parsed = null;
before(() => {
  const found = FILES.find((f) => existsSync(f));
  if (found) parsed = parseIbkrStatement(readFileSync(found, 'utf8'));
});
const withFile = (fn) => () => {
  if (!parsed) return; // statement not on this machine; nothing to assert
  fn();
};

describe('the parsed statement matches what IBKR states', () => {
  test('open positions, count and value', withFile(() => {
    assert.equal(parsed.positions.length, IB.openPositions);
    const mv = parsed.positions.reduce((s, p) => s + p.qty * p.cur, 0);
    const cost = parsed.positions.reduce((s, p) => s + p.qty * p.entry, 0);
    assert.ok(near(mv, IB.marketValue), `market value ${mv}`);
    assert.ok(near(cost, IB.costBasis), `cost basis ${cost}`);
    assert.ok(near(mv - cost, IB.unrealised), 'unrealised');
  }));

  test('realised profit, to the cent', withFile(() => {
    const realised = parsed.closed.reduce((s, c) => s + c.pnl, 0);
    assert.ok(near(realised, IB.realised), `realised ${realised}`);
  }));

  test('cash, dividends and commissions', withFile(() => {
    assert.ok(near(parsed.cash, IB.cash));
    assert.ok(near(parsed.income.dividends, IB.dividends));
    assert.ok(near(parsed.income.commissions, IB.commissions));
  }));

  test('deposits, with internal transfers excluded', withFile(() => {
    const net = parsed.flows.reduce((s, f) => s + f.amount, 0);
    assert.ok(near(net, IB.deposits), `net flows ${net}`);
    // The statement contains a 3,500 transfer between two of the same owner's
    // accounts, in and out. Counting either leg would invent money.
    assert.ok(
      !parsed.flows.some((f) => Math.abs(f.amount) === 3500),
      'an internal transfer was counted as external money',
    );
  }));

  test('the period is read from prose in the account language', withFile(() => {
    assert.equal(parsed.periodStart, '2026-01-01');
    assert.equal(parsed.periodEnd, '2026-08-28');
  }));

  test("the broker's own time-weighted return is picked up", withFile(() => {
    // It sits in the Net Asset Value block under a header of its own, as a lone
    // percentage with no column to look it up by. Without it this app can only
    // report Modified Dietz, which on this account reads three points high.
    assert.ok(near(parsed.twr, 28.900517844, 1e-9), `read ${parsed.twr}`);
  }));

  test('the journal carries it through to the return', withFile(() => {
    const nav = statementToJournal(parsed).openingNav;
    assert.equal(nav.through, '2026-08-28');
    assert.ok(near(nav.throughValue, IB.endNav));
    assert.ok(near(nav.twr, 28.900517844, 1e-9));

    // Read on the statement's own closing day it must be the broker's figure.
    const r = accountPerformance({
      positions: [], account: IB.endNav, from: '2026-01-01', to: '2026-08-28',
      flows: parsed.flows, openingNav: nav,
    });
    assert.equal(r.method, 'broker');
    assert.ok(near(r.returnPct, 28.900517844, 1e-9), `reported ${r.returnPct}`);
  }));
});

describe('the journal it builds', () => {
  test('reconciles to the broker on every headline figure', withFile(() => {
    loadState(statementToJournal(parsed));
    const t = accountTotals(state.positions, state.cash);

    assert.equal(t.open.length, IB.openPositions);
    assert.ok(near(t.unrealised, IB.unrealised), 'unrealised');
    assert.ok(near(t.realised, IB.realised), 'realised');
    assert.ok(near(state.cash, IB.cash), 'cash');
    // The remaining difference from IBKR's NAV is its accrued-dividend line,
    // which is money not yet paid and not a position.
    assert.ok(near(t.account, IB.endNav, 6), `account ${t.account}`);
  }));

  test('records the opening balance the statement states', withFile(() => {
    loadState(statementToJournal(parsed));
    assert.equal(state.openingNav.date, '2026-01-01');
    assert.ok(near(state.openingNav.value, IB.startNav));
  }));

  test('and the year\'s profit then falls out of the balance sheet', withFile(() => {
    loadState(statementToJournal(parsed));
    const t = accountTotals(state.positions, state.cash);
    const perf = accountPerformance({
      positions: state.positions,
      account: t.account,
      from: '2026-01-01',
      to: '2026-08-28',
      flows: state.cashFlows,
      openingNav: state.openingNav,
    });
    assert.equal(perf.method, 'statement', 'should use the stated opening balance');
    // IBKR's own "Total P&L for the period" is 10,334.02.
    assert.ok(near(perf.pnl, 10334.02, 6), `year P&L ${perf.pnl}`);
    assert.ok(perf.returnPct > 25 && perf.returnPct < 40, `return ${perf.returnPct}`);
  }));

  test('leaves the recorded account curve alone', withFile(() => {
    const snapshots = [{ date: '2026-08-12', value: 37224.45 }];
    const journal = statementToJournal(parsed, { snapshots });
    assert.deepEqual(journal.snapshots, snapshots, 'a statement cannot restate what the app observed');
  }));
});

describe('deposits change the answer', () => {
  test('ignoring them understates the return badly', () => {
    const flows = [
      { date: '2026-01-20', amount: 2000 }, { date: '2026-02-06', amount: 1997 },
      { date: '2026-03-23', amount: 1500 }, { date: '2026-03-31', amount: 1000 },
      { date: '2026-06-05', amount: 2000 },
    ];
    const pnl = 10334.02;
    const opening = 26365.95;

    const withFlows = modifiedDietzReturn(pnl, opening, flows, '2026-01-01', '2026-08-28');

    // Counting every deposit as though it had been present since January: the
    // base swells by the full 8,497 and the return is diluted by money that was
    // only there for part of the year.
    const unweighted = (pnl / (opening + 8497)) * 100;

    assert.ok(
      withFlows > unweighted + 2,
      `weighting should add at least two points: ${withFlows.toFixed(2)}% vs ${unweighted.toFixed(2)}%`,
    );
    assert.ok(withFlows > 30 && withFlows < 34, `expected low thirties, got ${withFlows}`);

    // And against what the app actually reported before any of this existed,
    // which was worse again: it derived the opening balance from today's value
    // and left out the holdings carried in from last year.
    assert.ok(withFlows > 24.01 + 6, 'the whole fix should be worth several points');
  });
});

describe('bad input', () => {
  test('a file that is not a statement is refused', () => {
    assert.throws(() => parseIbkrStatement('name,age\nromy,22\n'), /activity statement/i);
  });

  test('an empty statement is refused rather than wiping the journal', () => {
    assert.throws(
      () => parseIbkrStatement('Statement,Header,Field Name,Field Value\nStatement,Data,Title,Activity\n'),
      /No positions or trades/i,
    );
  });

  test('the summary reads as a sentence', withFile(() => {
    const text = describeStatement(parsed);
    assert.match(text, /14 open positions/);
    assert.match(text, /closed trades/);
  }));
});

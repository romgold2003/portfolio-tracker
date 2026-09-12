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
import { accountTotals, accountPerformance } from '../src/core/portfolio.js';

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
    // percentage with no column to look it up by. It is the only true
    // time-weighted return available — without it the app falls back to profit
    // over the opening balance, which is deposit-neutral but reads high on an
    // account whose capital grew a third during the year.
    assert.ok(near(parsed.twr, 28.900517844, 1e-9), `read ${parsed.twr}`);
  }));

  test('the journal carries it through to the return', withFile(() => {
    /**
     * Loaded through the store, not read straight off the parser. The first
     * version of this test took the object the importer returns and never
     * noticed that loading it dropped three of its fields on the way in — so
     * the app went on reporting the old figure while this passed.
     */
    loadState(statementToJournal(parsed));
    const nav = state.openingNav;
    assert.equal(nav.through, '2026-08-28');
    assert.ok(near(nav.throughValue, IB.endNav));
    assert.ok(near(nav.twr, 28.900517844, 1e-9));

    // Read on the statement's own closing day it must be the broker's figure.
    const r = accountPerformance({
      positions: [], account: IB.endNav, from: '2026-01-01', to: '2026-08-28',
      flows: state.cashFlows, openingNav: nav,
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
    // Either anchored method is right here; what must not happen is falling
    // back to counting the trades and assuming no money moved.
    assert.notEqual(perf.method, 'trades', 'should use the stated opening balance');
    // IBKR's own "Total P&L for the period" is 10,334.02.
    assert.ok(near(perf.pnl, 10334.02, 6), `year P&L ${perf.pnl}`);
    // Read on the statement's closing day, it is the broker's own return.
    assert.equal(perf.method, 'broker');
    assert.ok(near(perf.returnPct, 28.900517844, 1e-9), `return ${perf.returnPct}`);
  }));

  test('leaves the recorded account curve alone', withFile(() => {
    const snapshots = [{ date: '2026-08-12', value: 37224.45 }];
    const journal = statementToJournal(parsed, { snapshots });
    assert.deepEqual(journal.snapshots, snapshots, 'a statement cannot restate what the app observed');
  }));
});

describe('deposits are capital, not performance', () => {
  // The real statement's five deposits, $8,497 between them.
  const FLOWS = [
    { date: '2026-01-20', amount: 2000 }, { date: '2026-02-06', amount: 1997 },
    { date: '2026-03-23', amount: 1500 }, { date: '2026-03-31', amount: 1000 },
    { date: '2026-06-05', amount: 2000 },
  ];
  const PNL = 10334.02;
  const OPENING = 26365.95;
  const ACCOUNT = OPENING + PNL + 8497;

  const measure = (account, flows) => accountPerformance({
    positions: [], account, from: '2026-01-01', to: '2026-08-28', flows,
    openingNav: { date: '2026-01-01', value: OPENING },
  });

  test('the deposits are not mistaken for profit', () => {
    const r = measure(ACCOUNT, FLOWS);
    assert.equal(r.method, 'statement');
    // Profit is what the account gained beyond what was paid into it. Without
    // the flows term the $8,497 reads as a gain and the year reads near 72%.
    assert.ok(Math.abs(r.pnl - PNL) < 0.01, `${r.pnl} should be ${PNL}`);
  });

  test('and they are not mistaken for capital that was there in January', () => {
    // This was the original bug: the base swelled by the full $8,497, so money
    // that arrived in June diluted a return it had not been present to earn.
    const r = measure(ACCOUNT, FLOWS);
    const swollen = (PNL / (OPENING + 8497)) * 100;
    assert.ok(Math.abs(r.returnPct - (PNL / OPENING) * 100) < 1e-9);
    assert.ok(r.returnPct > swollen + 9,
      `${r.returnPct.toFixed(2)}% vs the old ${swollen.toFixed(2)}%`);
  });

  test('so paying money in leaves the year exactly where it was', () => {
    // The property that matters more than either number above: the account is
    // $8,497 bigger and the percentage is untouched.
    const none = measure(OPENING + PNL, []);
    const paid = measure(ACCOUNT, FLOWS);
    assert.ok(Math.abs(none.returnPct - paid.returnPct) < 1e-9,
      `${none.returnPct}% vs ${paid.returnPct}%`);
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

describe('the ledger the daily history is walked from', () => {
  /** A statement in miniature, with the rows that used to break the opening. */
  const csv = [
    'Statement,Header,Field Name,Field Value',
    'Statement,Data,Period,"January 1, 2026 - September 8, 2026"',
    'Net asset value,Header,Asset Class,Prior Total,Current Long,Current Short,Current Total,Change',
    'Net asset value,Data,Cash,2000,5000,0,5000,3000',
    'Net asset value,Data,Total,12000,25000,0,25000,13000',
    'Mark-to-market performance summary,Header,Asset Category,Symbol,Prior Quantity,Current Quantity,'
      + 'Prior Price,Current Price,Mark-to-Market P/L Position,Mark-to-Market P/L Transaction,'
      + 'Mark-to-Market P/L Commissions,Mark-to-Market P/L Other,Mark-to-Market P/L Total,Code',
    'Mark-to-market performance summary,Data,Stocks,AAA,100,120,100,150,5000,0,0,0,5000,',
    // The cash line wearing a symbol. Counting it as a holding doubled the cash.
    'Mark-to-market performance summary,Data,Forex,USD,2000,5000,1.0000,1.0000,0,0,0,0,0,',
    // A subtotal with figures but no quantity.
    'Mark-to-market performance summary,Data,Total,,,,,,5000,0,0,0,5000,',
    'Open positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Quantity,Mult,Cost Price,'
      + 'Cost Basis,Close Price,Value,Unrealized P/L,Code',
    'Open positions,Data,Summary,Stocks,USD,AAA,120,1,105,12600,150,18000,5400,',
    'Trades,Header,DataDiscriminator,Asset Category,Currency,Account,Symbol,Date/Time,Quantity,'
      + 'T. Price,Close Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code',
    'Trades,Data,Order,Stocks,USD,U1,AAA,"2026-03-02, 10:00:00",20,120,120,-2400,-1,2401,0,0,O',
    'Deposits & withdrawals,Header,Currency,Account,Settle Date,Description,Amount',
    'Deposits & withdrawals,Data,USD,U1,2026-02-10,Electronic fund transfer,1500',
    'Dividends,Header,Currency,Account,Date,Description,Amount',
    'Dividends,Data,USD,U1,2026-04-01,AAA cash dividend,40',
  ].join('\n');

  const ledger = () => statementToJournal(parseIbkrStatement(csv)).ledger;

  test('states the opening cash rather than inferring it', () => {
    assert.equal(ledger().openingCash, 2000);
  });

  test('takes the opening holdings from the prior quantities', () => {
    assert.deepEqual(ledger().openingHoldings, { AAA: 100 });
  });

  test('does not count the cash line as a holding', () => {
    // The Forex row is the cash balance with a symbol on it; folding it in
    // counted the cash twice and put the opening balance out by the whole of it.
    assert.ok(!('USD' in ledger().openingHoldings));
  });

  test('keeps the prior price, so an unpriceable holding still has a mark', () => {
    assert.equal(ledger().openingMarks.AAA, 100);
  });

  test('carries every dated event that moves shares or cash', () => {
    const kinds = ledger().events.map((e) => e.kind);
    assert.ok(kinds.includes('trade'));
    assert.ok(kinds.includes('flow'));
    assert.ok(kinds.includes('dividend'));
  });

  test('the events are in date order, which the forward walk relies on', () => {
    const dates = ledger().events.map((e) => e.date);
    assert.deepEqual(dates, [...dates].sort());
  });

  test('a deposit is a flow, and a dividend is not', () => {
    const events = ledger().events;
    assert.equal(events.find((e) => e.kind === 'flow').cash, 1500);
    assert.equal(events.find((e) => e.kind === 'dividend').cash, 40);
  });

  test('walking the events forward lands on the stated closing quantity', () => {
    const l = ledger();
    const held = { ...l.openingHoldings };
    for (const e of l.events) {
      if (e.ticker && (e.kind === 'trade' || e.kind === 'transfer')) {
        held[e.ticker] = (held[e.ticker] ?? 0) + e.qty;
      }
    }
    assert.deepEqual(held, l.holdings);
  });
});

describe('matching the broker to the cent', () => {
  /**
   * Two things that made the app disagree with the broker's own app, neither of
   * them an arithmetic error.
   *
   * The account value sat eighty-two cents under IBKR's, every time, because
   * dividends declared and not yet paid are their own line in net asset value
   * and were not read. Small, and the whole of the remaining difference — which
   * is the point: "small" and "explained" are not the same thing.
   *
   * And the file is a consolidated export of two accounts. Every figure in it is
   * their sum, while the broker's app opens on one of them, so the same day's
   * move over a different set of holdings is a different percentage. Nothing in
   * the numbers can reveal that; only the header can.
   */
  const FILES = [
    'C:/Users/User/OneDrive - Reichman University/Desktop/MULTI_20260101_20260911.csv',
    'C:/Users/User/Downloads/MULTI_20260101_20260911.csv',
  ];
  let latest = null;
  before(() => {
    const found = FILES.find((f) => existsSync(f));
    if (found) latest = parseIbkrStatement(readFileSync(found, 'utf8'));
  });
  const withLatest = (fn) => () => { if (latest) fn(); };

  test('dividend accruals are read', withLatest(() => {
    assert.ok(near(latest.accruals, 0.82), `accruals ${latest.accruals}`);
  }));

  test('and the account value then equals the broker\'s NAV exactly', withLatest(() => {
    loadState(statementToJournal(latest));
    const t = accountTotals(state.positions, state.cash);
    // IBKR's own Ending Value for this statement.
    assert.ok(near(t.account, 45743.381957646, 0.01), `account ${t.account}`);
  }));

  test('every open position matches the broker position for position', withLatest(() => {
    loadState(statementToJournal(latest));
    const open = state.positions.filter((p) => p.status === 'Open');
    assert.equal(open.length, 14);
    const value = open.reduce((s, p) => s + p.cur * p.qty, 0);
    assert.ok(near(value, 36472.61), `positions value ${value}`);
  }));

  test('the accounts the file covers are read', withLatest(() => {
    assert.deepEqual(latest.accounts, ['U16279720', 'U25235172']);
  }));

  test('and a consolidated file says so, because it is why figures differ', withLatest(() => {
    assert.match(describeStatement(latest), /covers 2 accounts combined/);
  }));

  test('a single-account file says nothing about it', () => {
    const one = {
      positions: [], closed: [], flows: [], cash: 0, accounts: ['U16279720'],
      income: { dividends: 0, commissions: 0, interest: 0, tax: 0 },
      twr: null, periodEnd: '2026-09-11',
    };
    assert.doesNotMatch(describeStatement(one), /accounts combined/);
  });
});

/**
 * Reporting the same return the broker's own app reports.
 *
 * The complaint this exists for: Interactive Brokers said 31% for the year and
 * this app said 34%, on a statement that had just been imported. Neither was a
 * bug — they were two different measures. IBKR reports a time-weighted return,
 * computed from the account valued every single day. This app had only the
 * statement's opening balance and the dates money moved, which gets you
 * Modified Dietz: the return on the capital you actually had at work, which
 * credits you for adding money before a good run and so read three points high.
 *
 * A journal cannot compute a true time-weighted return — it would need a
 * valuation on every flow date and it has none. But the broker already did, and
 * printed the answer on the statement, and a time-weighted return is chainable.
 * So their figure is used for the stretch it covers and only the days since are
 * measured here.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { accountPerformance, modifiedDietzReturn } from '../src/core/portfolio.js';

/**
 * The real statement, to the cent. Interactive Brokers, 1 January to 28 August
 * 2026, five external deposits netting $8,497 and two legs of an internal
 * transfer that cancel.
 */
const STATEMENT = {
  from: '2026-01-01',
  to: '2026-08-28',
  startNav: 26365.94901,
  endNav: 45202.041138846,
  twr: 28.900517844,
  flows: [
    { date: '2026-01-20', amount: 2000 },
    { date: '2026-02-06', amount: 1997 },
    { date: '2026-03-23', amount: 1500 },
    { date: '2026-03-31', amount: 1000 },
    { date: '2026-06-05', amount: 2000 },
  ],
};

const openingNav = (over = {}) => ({
  date: STATEMENT.from,
  value: STATEMENT.startNav,
  through: STATEMENT.to,
  throughValue: STATEMENT.endNav,
  twr: STATEMENT.twr,
  ...over,
});

const run = ({ account, to = STATEMENT.to, nav = openingNav(), flows = STATEMENT.flows }) =>
  accountPerformance({
    positions: [], account, from: STATEMENT.from, to, flows, openingNav: nav,
  });

describe('the broker had already done the hard part', () => {
  test('on the statement\'s own closing day, the figure is theirs exactly', () => {
    const r = run({ account: STATEMENT.endNav });
    assert.equal(r.method, 'broker');
    assert.ok(Math.abs(r.returnPct - STATEMENT.twr) < 1e-9,
      `reported ${r.returnPct}, statement says ${STATEMENT.twr}`);
  });

  test('the reported complaint: 31 where the old method said 34', () => {
    // The account a few days on, unchanged deposits.
    const account = 46000;
    const now = run({ account, to: '2026-09-03' });
    const dietz = run({ account, to: '2026-09-03', nav: openingNav({ twr: null }) });

    assert.equal(now.method, 'broker');
    assert.equal(dietz.method, 'statement');
    assert.equal(now.returnPct.toFixed(1), '31.2');
    assert.equal(dietz.returnPct.toFixed(1), '34.5');
  });

  test('the sub-periods compound rather than adding', () => {
    const account = 47000;
    const r = run({ account, to: '2026-09-03' });
    const stub = modifiedDietzReturn(
      account - STATEMENT.endNav, STATEMENT.endNav, [], STATEMENT.to, '2026-09-03',
    );
    const expected = ((1 + STATEMENT.twr / 100) * (1 + stub / 100) - 1) * 100;
    assert.ok(Math.abs(r.returnPct - expected) < 1e-9);
    // Compounding is not addition, and on figures this size the gap is visible.
    assert.notEqual(r.returnPct.toFixed(2), (STATEMENT.twr + stub).toFixed(2));
  });

  test('a deposit after the statement does not read as profit', () => {
    // $4,000 paid in on 1 September and nothing else: the account is larger and
    // the return must not be.
    const flows = [...STATEMENT.flows, { date: '2026-09-01', amount: 4000 }];
    const r = run({ account: STATEMENT.endNav + 4000, to: '2026-09-03', flows });
    assert.ok(Math.abs(r.returnPct - STATEMENT.twr) < 1e-9,
      'paying money in changed the return');
  });

  test('the dollar profit is unaffected by how the return is measured', () => {
    const account = 46000;
    const a = run({ account, to: '2026-09-03' });
    const b = run({ account, to: '2026-09-03', nav: openingNav({ twr: null }) });
    assert.equal(a.pnl, b.pnl);
    assert.equal(a.pnl, account - STATEMENT.startNav - 8497);
  });
});

describe('falling back rather than guessing', () => {
  test('a statement with no time-weighted return uses Modified Dietz', () => {
    const r = run({ account: 46000, to: '2026-09-03', nav: openingNav({ twr: null }) });
    assert.equal(r.method, 'statement');
    assert.equal(r.brokerTwr, null, 'nothing to attribute to the broker');
  });

  test('an old stored statement, from before this was read, still works', () => {
    // Anything imported before this existed has only the two fields.
    const r = run({
      account: 46000,
      to: '2026-09-03',
      nav: { date: STATEMENT.from, value: STATEMENT.startNav },
    });
    assert.equal(r.method, 'statement');
    assert.ok(r.returnPct > 0);
  });

  test('a closing balance of nothing is not a base to divide by', () => {
    const r = run({ account: 46000, to: '2026-09-03', nav: openingNav({ throughValue: 0 }) });
    assert.equal(r.method, 'statement');
  });

  test('a statement reaching past the day asked about is not used', () => {
    // Asking for the year to 15 August from a statement that closes on the 28th
    // cannot be answered by chaining; the broker's figure covers too much.
    const r = run({ account: 40000, to: '2026-08-15' });
    assert.equal(r.method, 'statement');
  });

  test('with no statement at all it falls back to the trades', () => {
    const r = accountPerformance({
      positions: [], account: 46000, from: STATEMENT.from, to: '2026-09-03', flows: [], openingNav: null,
    });
    assert.equal(r.method, 'trades');
  });
});

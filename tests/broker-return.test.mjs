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
 *
 * Modified Dietz has since been dropped from the fallback too. It answers a
 * question nobody asked it — "what did my money earn" — by weighting deposits
 * into the base, so paying money in moved the percentage on a day with no trades
 * at all. The fallback is now profit over the opening balance, which cannot see
 * a deposit.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { accountPerformance } from '../src/core/portfolio.js';
import { state, loadState } from '../src/core/store.js';

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

  test('the broker figure is used whenever they gave us one', () => {
    const account = 46000;
    const now = run({ account, to: '2026-09-03' });
    const fallback = run({ account, to: '2026-09-03', nav: openingNav({ twr: null }) });

    assert.equal(now.method, 'broker');
    assert.equal(fallback.method, 'statement');
    assert.equal(now.returnPct.toFixed(1), '31.2');

    /**
     * The fallback reads higher, and it is worth being clear about why rather
     * than tuning it to look closer.
     *
     * It is the period's profit over the balance the period opened with, which
     * is deposit-neutral: paying money in cannot move it, because the deposit
     * is out of both halves. The cost of that is it credits the whole profit to
     * the opening capital, when some of it was earned by money that arrived
     * later — so on a book that doubled its size mid-year it overstates.
     *
     * Modified Dietz used to sit here and read 34.5%, closer to the broker's
     * 31.2% — but it moved whenever money was paid in, which is the one thing
     * this app's returns must never do. The broker's own chained figure is both
     * neutral and exact, which is why it is preferred whenever it exists; this
     * is only what happens when a statement arrives without one.
     */
    assert.equal(fallback.returnPct.toFixed(1), '42.2');
    assert.ok(fallback.returnPct > now.returnPct);
  });

  test('and the fallback does not move when money is paid in', () => {
    const nav = openingNav({ twr: null });
    const bare = run({ account: 46000, to: '2026-09-03', nav, flows: [] });
    const funded = run({
      account: 56000, to: '2026-09-03', nav,
      flows: [{ date: '2026-05-01', amount: 10000 }],
    });
    assert.ok(Math.abs(bare.returnPct - funded.returnPct) < 1e-9,
      `${bare.returnPct} vs ${funded.returnPct}`);
  });

  test('the sub-periods compound rather than adding', () => {
    const account = 47000;
    const r = run({ account, to: '2026-09-03' });
    // The days since the statement closed, on the balance it closed with.
    const stub = ((account - STATEMENT.endNav) / STATEMENT.endNav) * 100;
    const expected = ((1 + STATEMENT.twr / 100) * (1 + stub / 100) - 1) * 100;
    assert.ok(Math.abs(r.returnPct - expected) < 1e-9);
    // Compounding is not addition, and on figures this size the gap is visible.
    assert.notEqual(r.returnPct.toFixed(2), (STATEMENT.twr + stub).toFixed(2));
  });

  test('a deposit in the stub does not move the year either', () => {
    // The narrower case below only proves a deposit is not itself counted as
    // profit. This is the one that was actually wrong: with real profit in the
    // stub, Modified Dietz weighted the deposit into the base, and $10,000 paid
    // in on 2 September moved the reported year by nearly a point — 34.60% to
    // 33.70% — with not a single trade between the two.
    const base = { to: '2026-09-30' };
    const flat = run({ ...base, account: STATEMENT.endNav + 2000, flows: [] });
    const paid = run({
      ...base,
      account: STATEMENT.endNav + 2000 + 10_000,
      flows: [{ date: '2026-09-02', amount: 10_000 }],
    });
    assert.equal(flat.method, 'broker');
    assert.equal(paid.method, 'broker');
    assert.ok(Math.abs(flat.returnPct - paid.returnPct) < 1e-9,
      `${flat.returnPct}% vs ${paid.returnPct}%`);
  });

  test('and when it landed in the stub is equally irrelevant', () => {
    const early = run({
      to: '2026-09-30', account: STATEMENT.endNav + 12_000,
      flows: [{ date: '2026-08-29', amount: 10_000 }],
    });
    const late = run({
      to: '2026-09-30', account: STATEMENT.endNav + 12_000,
      flows: [{ date: '2026-09-29', amount: 10_000 }],
    });
    assert.ok(Math.abs(early.returnPct - late.returnPct) < 1e-9,
      `${early.returnPct}% vs ${late.returnPct}%`);
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
  test('a statement with no time-weighted return is measured from its opening balance', () => {
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

describe('surviving the trip through the vault', () => {
  test("the broker's figures are not dropped on the way in", () => {
    // They were. loadState sanitises everything it reads, and the anchor's
    // sanitiser listed only the opening date and balance — so a freshly
    // imported statement lost its time-weighted return before anything could
    // use it, and the app reported Modified Dietz as though none had been read.
    loadState({
      positions: [],
      cash: 0,
      cashFlows: STATEMENT.flows,
      openingNav: openingNav(),
    });

    assert.equal(state.openingNav.through, STATEMENT.to);
    assert.ok(Math.abs(state.openingNav.throughValue - STATEMENT.endNav) < 1e-9);
    assert.ok(Math.abs(state.openingNav.twr - STATEMENT.twr) < 1e-9);

    const r = accountPerformance({
      positions: [], account: STATEMENT.endNav, from: STATEMENT.from, to: STATEMENT.to,
      flows: state.cashFlows, openingNav: state.openingNav,
    });
    assert.equal(r.method, 'broker');
  });

  test('a malformed closing end is left off rather than trusted', () => {
    loadState({
      positions: [],
      cash: 0,
      openingNav: openingNav({ through: 'last Tuesday', throughValue: -5, twr: 'lots' }),
    });
    const nav = state.openingNav;
    assert.equal(nav.date, STATEMENT.from, 'the anchor itself still stands');
    assert.equal(nav.through, undefined);
    assert.equal(nav.throughValue, undefined);
    assert.equal(nav.twr, undefined);
  });

  test('a return of exactly zero is a figure, not a missing one', () => {
    loadState({ positions: [], cash: 0, openingNav: openingNav({ twr: 0 }) });
    assert.equal(state.openingNav.twr, 0);
  });

  test('an anchor with no opening balance is still refused entirely', () => {
    loadState({ positions: [], cash: 0, openingNav: { date: 'nonsense', value: 10 } });
    assert.equal(state.openingNav, null);
  });
});

describe('saying whether the broker figure was found', () => {
  test('the preview names it, so a silent fallback cannot go unnoticed', async () => {
    const { describeStatement } = await import('../src/features/ibkr.js');
    const base = {
      positions: [], closed: [], flows: [], cash: 0,
      income: { dividends: 0, commissions: 0, interest: 0, tax: 0 },
    };
    const found = describeStatement({ ...base, twr: 27.562836129, periodEnd: '2026-09-02' });
    assert.match(found, /broker's own return 27\.56% through 2026-09-02/);

    // And its absence is stated rather than left blank, because a missing
    // return changes how the year is measured and nothing else would show it.
    const missing = describeStatement({ ...base, twr: null, periodEnd: '2026-09-02' });
    assert.match(missing, /no broker return in this file/);
  });
});

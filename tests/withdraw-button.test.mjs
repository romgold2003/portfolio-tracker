/**
 * The Withdraw button, end to end.
 *
 * The maths for money going out was already right — a flow in the day's row is
 * taken off before the day is compounded — but the button never reached it. It
 * writes to `cashFlows`, and every daily figure is built from the *ledger*, the
 * events read out of the broker's files. So a withdrawal made in the app was
 * invisible: the account fell, nothing on record explained it, and the day, the
 * year and everything drawn from them booked it as a loss.
 *
 * Reported twice on a real account: the year to date still went down after a
 * withdrawal, and so did the daily return. Sometimes traders take money to
 * their bank; it must move no percentage at all.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  withManualFlows, manualFlowEvents, manualFlowsBetween,
  buildPortfolioHistory, periodReturnFromHistory, allTimeFromDeposits,
} from '../src/core/portfolioHistory.js';
import { dailyPortfolioMove } from '../src/core/portfolio.js';
import { sanitizeFlows } from '../src/core/store.js';

/** What the Withdraw button writes: a flow marked as moved by hand. */
const withdrawal = (date, amount) => ({ date, amount: -amount, description: 'Withdrawal', manual: true });
/** What an import writes: the same shape, from a file, with no marker. */
const imported = (date, amount) => ({ date, amount, description: 'Deposit' });

describe('a withdrawal made in the app reaches the daily walk', () => {
  test('the marker survives being saved and loaded again', () => {
    const [saved] = sanitizeFlows([withdrawal('2026-09-23', 3000)]);
    assert.equal(saved.manual, true);
    assert.equal(saved.amount, -3000);
    // An imported flow keeps no marker: it is already an event in the ledger.
    assert.equal(sanitizeFlows([imported('2026-03-01', 5000)])[0].manual, undefined);
  });

  test("it becomes a dated flow event, in order among the ledger's own", () => {
    const events = [
      { date: '2026-01-05', at: '2026-01-05 10:00:00', kind: 'buy', ticker: 'VOO', qty: 10, cash: -5000 },
      { date: '2026-11-02', at: '2026-11-02 10:00:00', kind: 'sell', ticker: 'VOO', qty: -10, cash: 6000 },
    ];
    const joined = withManualFlows(events, [withdrawal('2026-06-01', 3000), imported('2026-01-02', 5000)]);
    assert.deepEqual(joined.map((e) => e.date), ['2026-01-05', '2026-06-01', '2026-11-02']);
    // Only the hand-moved one: the imported deposit is already in the ledger.
    assert.equal(joined.filter((e) => e.kind === 'flow').length, 1);
    assert.equal(joined[1].cash, -3000);
  });

  test('no hand-moved money leaves the ledger exactly as it was', () => {
    const events = [{ date: '2026-01-05', at: '2026-01-05 10:00:00', kind: 'buy', ticker: 'VOO', qty: 1, cash: -500 }];
    assert.equal(withManualFlows(events, [imported('2026-01-02', 500)]), events);
    assert.deepEqual(manualFlowEvents([]), []);
    assert.deepEqual(manualFlowEvents(undefined), []);
  });
});

describe('the year and the day do not move when money is taken out', () => {
  // A flat account: $10,000 of cash, opened on 1 January, nothing traded.
  const history = (flows) => buildPortfolioHistory({
    opening: { date: '2026-01-01', cash: 10_000, holdings: {} },
    events: withManualFlows([], flows),
    priceOn: () => 0,
    lastKnown: {},
    from: '2026-01-01',
    to: '2026-09-23',
  });

  test('year to date is flat after a $3,000 withdrawal, as it was before', () => {
    const after = periodReturnFromHistory(history([withdrawal('2026-06-01', 3000)]), '2026-01-01', '2026-12-31');
    const never = periodReturnFromHistory(history([]), '2026-01-01', '2026-12-31');
    assert.ok(Math.abs(after.returnPct) < 1e-9, `${after.returnPct}%`);
    assert.ok(Math.abs(after.returnPct - never.returnPct) < 1e-9);
    // The value did fall, which is the whole point of recording it.
    assert.equal(after.endValue, 7000);
    assert.equal(never.endValue, 10_000);
  });

  test('the withdrawal is not booked as profit or loss either', () => {
    const r = periodReturnFromHistory(history([withdrawal('2026-06-01', 3000)]), '2026-01-01', '2026-12-31');
    assert.ok(Math.abs(r.pnl) < 1e-9, `${r.pnl}`);
  });

  test("the day's move ignores the money that left today", () => {
    // $11,000 yesterday, $3,000 taken out today, nothing else: 0.00%, not −27%.
    const events = withManualFlows([], [withdrawal('2026-09-23', 3000)]);
    const move = dailyPortfolioMove([], 8000, '2026-09-23', events);
    assert.ok(Math.abs(move.percent) < 1e-9, `${move.percent}%`);
    assert.ok(Math.abs(move.dollars) < 1e-9, `${move.dollars}`);
  });

  test('a real gain still shows on the day money also left', () => {
    // Yesterday $10,000, up $500 today, $3,000 out: +5% on $10,000.
    const positions = [{ ticker: 'VOO', status: 'Open', dir: 'Long', qty: 10, entry: 600, cur: 650, prevClose: 600, open: '2026-01-05' }];
    const events = withManualFlows([], [withdrawal('2026-09-23', 3000)]);
    const move = dailyPortfolioMove(positions, 7500, '2026-09-23', events);
    assert.ok(Math.abs(move.dollars - 500) < 1e-6, `${move.dollars}`);
    assert.ok(Math.abs(move.percent - 5) < 1e-6, `${move.percent}%`);
  });

  test('money moved after the walk ends is carried by the row that closes it', () => {
    // A statement history stopping in June, with $1,000 taken out in August.
    const flows = [withdrawal('2026-08-04', 1000), imported('2026-02-01', 5000)];
    assert.equal(manualFlowsBetween(flows, '2026-06-30', '2026-09-23'), -1000);
    // Nothing outside the window.
    assert.equal(manualFlowsBetween(flows, '2026-08-04', '2026-09-23'), 0);
    assert.equal(manualFlowsBetween(flows, '2026-01-01', '2026-06-30'), 0);
  });
});

describe('all time counts money taken out as value earned, not money never put in', () => {
  test('withdrawing does not lift the return on its own', () => {
    const paid = [{ date: '2026-01-01', amount: 20_075 }];
    const before = allTimeFromDeposits(paid, 22_869.42);
    const after = allTimeFromDeposits([...paid, withdrawal('2026-03-13', 1175)], 21_694.42);
    assert.ok(Math.abs(after.returnPct - before.returnPct) < 1e-9, `${before.returnPct} → ${after.returnPct}`);
    // The profit is the same money either way: it is simply held in two places.
    assert.ok(Math.abs(after.pnl - before.pnl) < 1e-9);
    assert.ok(Math.abs(after.returnPct - 13.92) < 0.01, `${after.returnPct}`);
  });

  test('an account with no withdrawals reads exactly as it did', () => {
    const r = allTimeFromDeposits([{ date: '2024-11-19', amount: 30_508.51 }], 45_648.87);
    assert.ok(Math.abs(r.pnl - 15_140.36) < 0.005);
    assert.ok(Math.abs(r.returnPct - 49.63) < 0.005, `${r.returnPct}`);
  });

  test('taking out more than was paid in is a real return, not a blank', () => {
    // $1,000 in, $1,500 out, $800 still there: the money more than doubled.
    const r = allTimeFromDeposits([{ date: '2025-01-02', amount: 1000 }, withdrawal('2025-06-02', 1500)], 800);
    assert.ok(Math.abs(r.pnl - 1300) < 1e-9, `${r.pnl}`);
    assert.ok(Math.abs(r.returnPct - 130) < 1e-9, `${r.returnPct}%`);
  });
});

/**
 * The whole point, as one account.
 *
 * $10,000 — $3,000 of cash and 10 shares marked at $700 — flat since January.
 * $3,000 is taken out on 1 June, and the shares then rise 10% the next day.
 *
 * Nothing that already happened may move: the year is still flat through 31
 * May, and 1 June itself is 0.00%. What comes after is measured on the smaller
 * account, which is the real consequence of taking money out — the same $700
 * earned on 2 June is 10% of what is left, where it would have been 7% of the
 * account that kept the money.
 */
describe('taking $3,000 out of a $10,000 account', () => {
  const priceOn = (_ticker, day) => (day < '2026-06-02' ? 700 : 770);
  const history = (flows) => buildPortfolioHistory({
    opening: { date: '2026-01-01', cash: 3000, holdings: { VOO: 10 } },
    events: withManualFlows([], flows),
    priceOn,
    lastKnown: {},
    from: '2026-01-01',
    to: '2026-06-02',
  });

  const took = history([withdrawal('2026-06-01', 3000)]);
  const kept = history([]);
  const on = (rows, date) => rows.find((r) => r.date === date);

  test('the account falls by exactly the amount, and only then', () => {
    assert.equal(on(took, '2026-05-31').totalAccountValue, 10_000);
    assert.equal(on(took, '2026-06-01').totalAccountValue, 7000);
    assert.equal(on(kept, '2026-06-01').totalAccountValue, 10_000);
  });

  test('no percentage already earned moves: the year is flat up to the day', () => {
    const before = periodReturnFromHistory(took, '2026-01-01', '2026-05-31');
    const same = periodReturnFromHistory(kept, '2026-01-01', '2026-05-31');
    assert.ok(Math.abs(before.returnPct) < 1e-9, `${before.returnPct}%`);
    assert.ok(Math.abs(before.returnPct - same.returnPct) < 1e-9);
  });

  test('the day it is taken out reads 0.00%, not −30%', () => {
    const day = periodReturnFromHistory(took, '2026-06-01', '2026-06-01');
    assert.ok(Math.abs(day.returnPct) < 1e-9, `${day.returnPct}%`);
  });

  test('afterwards it is measured on what is left, which is the whole effect', () => {
    // $700 earned on 2 June: 10% of the $7,000 left, 7% of the $10,000 kept.
    const after = periodReturnFromHistory(took, '2026-06-02', '2026-06-02');
    const had = periodReturnFromHistory(kept, '2026-06-02', '2026-06-02');
    assert.ok(Math.abs(after.returnPct - 10) < 1e-9, `${after.returnPct}%`);
    assert.ok(Math.abs(had.returnPct - 7) < 1e-9, `${had.returnPct}%`);
    // Same dollars earned either way — the account is simply smaller.
    assert.ok(Math.abs(after.pnl - had.pnl) < 1e-9);
  });

  test('and the year reads the two stretches compounded, as it should', () => {
    const year = periodReturnFromHistory(took, '2026-01-01', '2026-12-31');
    assert.ok(Math.abs(year.returnPct - 10) < 1e-9, `${year.returnPct}%`);
    assert.ok(Math.abs(year.pnl - 700) < 1e-9, `${year.pnl}`);
  });
});

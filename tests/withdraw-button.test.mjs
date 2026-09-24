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

import { buildPortfolioHistory, periodReturnFromHistory, allTimeFromDeposits } from '../src/core/portfolioHistory.js';
import { dailyPortfolioMove } from '../src/core/portfolio.js';
import { sanitizeFlows, handEnteredFlows } from '../src/core/store.js';
import { statementRecord, journalFromStatements } from '../src/features/statementLibrary.js';

/** What the Withdraw button writes: a flow marked as moved by hand. */
const withdrawal = (date, amount) => ({ date, amount: -amount, description: 'Withdrawal', manual: true });
/** What an import writes: the same shape, from a file, with no marker. */
const imported = (date, amount) => ({ date, amount, description: 'Deposit' });
/** A flow as the ledger keeps it, which is where every daily figure reads it. */
const asEvent = (f) => ({ date: f.date, kind: 'flow', cash: f.amount });

describe('a withdrawal made in the app reaches the ledger', () => {
  test('the marker survives being saved and loaded again', () => {
    const [saved] = sanitizeFlows([withdrawal('2026-09-23', 3000)]);
    assert.equal(saved.manual, true);
    assert.equal(saved.amount, -3000);
    // An imported flow keeps no marker: it is already an event in the ledger.
    assert.equal(sanitizeFlows([imported('2026-03-01', 5000)])[0].manual, undefined);
  });

  test('and only the hand-moved ones are picked out', () => {
    const flows = [withdrawal('2026-06-01', 3000), imported('2026-01-02', 5000)];
    assert.deepEqual(handEnteredFlows({ cashFlows: flows }).map((f) => f.amount), [-3000]);
    assert.deepEqual(handEnteredFlows({ cashFlows: [] }), []);
    assert.deepEqual(handEnteredFlows(undefined), []);
  });

  /**
   * The failure this replaced. Rebuilding the journal from the statements
   * erased it: importing next month's file put the cash back and the
   * withdrawal vanished, with nothing said.
   */
  describe('and survives the journal being rebuilt from the files', () => {
    const statement = [
      'Statement,Header,Field Name,Field Value',
      'Statement,Data,BrokerName,Interactive Brokers LLC',
      'Statement,Data,Title,Activity Statement',
      'Statement,Data,Period,"January 01, 2026 - September 21, 2026"',
      'Account Information,Header,Field Name,Field Value',
      'Account Information,Data,Base Currency,USD',
      'Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,Realized P/L %,MTM P/L,Code',
      'Trades,Data,Order,Stocks,USD,VOO,"2026-02-02, 10:00:00",2,600,,-1200,0,1200,0.0,,0,O',
      'Deposits & Withdrawals,Header,Currency,Settle Date,Description,Amount',
      'Deposits & Withdrawals,Data,USD,2026-02-02,Deposit,1200',
      'Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code',
      'Open Positions,Data,Summary,Stocks,USD,VOO,2,1,600,1200,700,1400,200,',
    ].join('\n');

    const rebuild = async (existing) => {
      const { parseIbkrStatement } = await import('../src/features/ibkr.js');
      return journalFromStatements([statementRecord(parseIbkrStatement(statement))], existing);
    };

    test('the flow is still there, and the file\'s own deposits with it', async () => {
      const first = await rebuild({});
      const took = { ...first, cashFlows: [...first.cashFlows, withdrawal('2026-09-24', 3000)] };
      const again = await rebuild(took);
      assert.equal(again.cashFlows.filter((f) => f.manual).length, 1, 'the withdrawal was erased');
      assert.deepEqual(again.cashFlows.filter((f) => !f.manual).map((f) => f.amount), [1200]);
    });

    test('it is folded into the ledger, where every daily figure reads it', async () => {
      const first = await rebuild({});
      const again = await rebuild({ ...first, cashFlows: [...first.cashFlows, withdrawal('2026-09-24', 3000)] });
      const flows = again.ledger.events.filter((e) => e.kind === 'flow');
      assert.deepEqual(flows.map((e) => e.cash), [1200, -3000], 'in date order, beside the statement\'s own');
    });

    test('and is not duplicated by rebuilding a second time', async () => {
      const first = await rebuild({});
      const took = { ...first, cashFlows: [...first.cashFlows, withdrawal('2026-09-24', 3000)] };
      const twice = await rebuild(await rebuild(took));
      assert.equal(twice.cashFlows.filter((f) => f.manual).length, 1);
      assert.equal(twice.ledger.events.filter((e) => e.kind === 'flow' && e.cash === -3000).length, 1);
    });
  });
});

describe('the year and the day do not move when money is taken out', () => {
  // A flat account: $10,000 of cash, opened on 1 January, nothing traded.
  const history = (flows) => buildPortfolioHistory({
    opening: { date: '2026-01-01', cash: 10_000, holdings: {} },
    events: flows.map(asEvent),
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
    const events = [asEvent(withdrawal('2026-09-23', 3000))];
    const move = dailyPortfolioMove([], 8000, '2026-09-23', events);
    assert.ok(Math.abs(move.percent) < 1e-9, `${move.percent}%`);
    assert.ok(Math.abs(move.dollars) < 1e-9, `${move.dollars}`);
  });

  test('a real gain still shows on the day money also left', () => {
    // Yesterday $10,000, up $500 today, $3,000 out: +5% on $10,000.
    const positions = [{ ticker: 'VOO', status: 'Open', dir: 'Long', qty: 10, entry: 600, cur: 650, prevClose: 600, open: '2026-01-05' }];
    const events = [asEvent(withdrawal('2026-09-23', 3000))];
    const move = dailyPortfolioMove(positions, 7500, '2026-09-23', events);
    assert.ok(Math.abs(move.dollars - 500) < 1e-6, `${move.dollars}`);
    assert.ok(Math.abs(move.percent - 5) < 1e-6, `${move.percent}%`);
  });

  test('a withdrawal inside the walk lands on its own day, not the last one', () => {
    const rows = history([withdrawal('2026-08-04', 1000)]);
    const day = rows.find((r) => r.date === '2026-08-04');
    assert.equal(day.externalCashFlow, -1000);
    assert.equal(day.withdrawal, -1000);
    // And nowhere else.
    assert.equal(rows.filter((r) => r.externalCashFlow !== 0).length, 1);
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
    events: flows.map(asEvent),
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

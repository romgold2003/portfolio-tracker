/**
 * Two returns, and the whole point is that they are two.
 *
 * The average trade return says how the typical decision worked out. The
 * portfolio return says what the account actually did. A month can be strongly
 * positive on one and flat on the other, and neither is the other's rounding
 * error.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  avgTradeReturn, monthlyAccountReturns, monthPnl, monthRange, accountTotals,
} from '../src/core/portfolio.js';

const closed = (entry, exit, qty, open, close) => ({
  status: 'Closed', dir: 'Long', entry, cur: exit, qty, open, close,
});
const open = (entry, now, qty, opened) => ({
  status: 'Open', dir: 'Long', entry, cur: now, qty, open: opened,
});
const round = (n, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

describe('the average trade return', () => {
  test('counts each trade once, whatever it was sized at', () => {
    // Two winners of 10% on tiny size and one loser of -20% on huge size. By
    // dollars this month is a disaster; by decision quality it is mixed.
    const avg = avgTradeReturn([
      closed(100, 110, 1, '2026-08-01', '2026-08-10'),
      closed(100, 110, 1, '2026-08-01', '2026-08-10'),
      closed(100, 80, 1000, '2026-08-01', '2026-08-10'),
    ]);
    assert.equal(round(avg), 0);
  });

  test('is not the month P&L over the month capital', () => {
    const trades = [
      closed(100, 110, 1, '2026-08-01', '2026-08-10'),
      closed(100, 80, 1000, '2026-08-01', '2026-08-10'),
    ];
    assert.equal(round(avgTradeReturn(trades), 1), -5);
    assert.equal(round(((10 - 20000) / (100 + 100000)) * 100, 1), -20);
  });

  test('a short is measured in its own direction', () => {
    const short = { status: 'Closed', dir: 'Short', entry: 100, cur: 90, qty: 10 };
    assert.equal(avgTradeReturn([short]), 10);
  });

  test('nothing to average is absent, not flat', () => {
    assert.equal(avgTradeReturn([]), null);
    assert.equal(avgTradeReturn([closed(0, 10, 5, '2026-08-01', '2026-08-10')]), null);
  });
});

describe('the months a book covers', () => {
  test('runs continuously, quiet months included', () => {
    assert.deepEqual(monthRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  test('a single month is a range of one', () => {
    assert.deepEqual(monthRange('2026-08', '2026-08'), ['2026-08']);
  });

  test('an end before the start is empty rather than endless', () => {
    assert.deepEqual(monthRange('2027-01', '2026-01'), []);
  });
});

describe('P&L is attributed to the month that did the work', () => {
  test('a closed trade belongs to the month it closed in', () => {
    const map = monthPnl([closed(100, 150, 10, '2026-01-05', '2026-08-20')]);
    assert.equal(map.get('2026-08').pnl, 500);
    assert.equal(map.has('2026-01'), false);
  });

  test('a position still open belongs to the month it was taken in', () => {
    const map = monthPnl([open(100, 150, 10, '2026-03-05')]);
    assert.equal(map.get('2026-03').pnl, 500);
    assert.equal(map.get('2026-03').marked, 1);
  });

  test('every dollar is attributed exactly once', () => {
    // This is what lets the chain arrive back at the real starting capital
    // instead of drifting a little further off with every month.
    const book = [
      closed(100, 150, 10, '2026-01-05', '2026-02-20'),
      closed(100, 60, 5, '2026-03-01', '2026-04-11'),
      open(200, 260, 3, '2026-06-02'),
    ];
    const total = [...monthPnl(book).values()].reduce((sum, m) => sum + m.pnl, 0);
    assert.equal(round(total), 500 - 200 + 180);
  });
});

describe('the portfolio return, month by month', () => {
  const book = [
    closed(100, 120, 50, '2025-12-10', '2026-01-20'),   // +1,000 in January
    closed(100, 90, 50, '2026-02-02', '2026-02-25'),    //   -500 in February
    open(100, 130, 40, '2026-03-05'),                   // +1,200 marked to today
  ];
  const account = 21700;

  test('every month the book has lived gets an answer, not just the recent ones', () => {
    // The complaint that started this: months before the app was installed had
    // no recorded account value, so they showed nothing at all.
    const r = monthlyAccountReturns(book, account, [], '2026-03-31');
    assert.deepEqual([...r.keys()].sort(), ['2025-12', '2026-01', '2026-02', '2026-03']);
    assert.ok([...r.values()].every((m) => m.pct != null));
  });

  test('the chain walks back to the capital the account started with', () => {
    const r = monthlyAccountReturns(book, account, [], '2026-03-31');
    // 21,700 today, less 1,000 - 500 + 1,200 ever earned.
    assert.equal(round(r.get('2025-12').opening), 20000);
    assert.equal(round(r.get('2026-01').opening), 20000);
    assert.equal(round(r.get('2026-03').closing), account);
  });

  test('each month is its P&L over what the account was worth then', () => {
    const r = monthlyAccountReturns(book, account, [], '2026-03-31');
    assert.equal(round(r.get('2026-01').pct), 5);          // 1,000 on 20,000
    assert.equal(round(r.get('2026-02').pct), round(-500 / 21000 * 100));
    assert.equal(round(r.get('2026-03').pct), round(1200 / 20500 * 100));
  });

  test('a quiet month is flat, not missing', () => {
    const r = monthlyAccountReturns(book, account, [], '2026-03-31');
    assert.equal(r.get('2025-12').pct, 0);
  });

  test('a deposit is not profit, in either direction', () => {
    const flows = [{ date: '2026-02-10', amount: 10000 }];
    const withFlow = monthlyAccountReturns(book, account + 10000, flows, '2026-03-31');
    const without = monthlyAccountReturns(book, account, [], '2026-03-31');
    // February earned exactly what it earned, deposit or no deposit.
    assert.equal(withFlow.get('2026-02').pnl, without.get('2026-02').pnl);
    // And the months before it are not credited with capital that had not
    // arrived yet, which is the error that inflated the historical bases.
    assert.equal(round(withFlow.get('2026-01').opening), round(without.get('2026-01').opening));
  });

  test('when the deposit landed changes nothing', () => {
    // This used to be weighted by how much of the month the money was present —
    // Modified Dietz — which is the right answer to "what did my money make"
    // and the wrong one here: it let paying money in move the percentage
    // without a single trade changing. A deposit is capital to work with, not
    // a result, so it is out of the base entirely and its date cannot matter.
    const early = monthlyAccountReturns(book, 31700, [{ date: '2026-02-01', amount: 10000 }], '2026-03-31');
    const late = monthlyAccountReturns(book, 31700, [{ date: '2026-02-27', amount: 10000 }], '2026-03-31');
    assert.equal(early.get('2026-02').pnl, late.get('2026-02').pnl);
    assert.equal(early.get('2026-02').pct, late.get('2026-02').pct);
  });

  test('and depositing at all changes nothing', () => {
    const without = monthlyAccountReturns(book, account, [], '2026-03-31');
    const withFlow = monthlyAccountReturns(book, account + 10000,
      [{ date: '2026-02-10', amount: 10000 }], '2026-03-31');
    assert.ok(Math.abs(without.get('2026-02').pct - withFlow.get('2026-02').pct) < 1e-9,
      `${without.get('2026-02').pct} vs ${withFlow.get('2026-02').pct}`);
  });

  test('a withdrawal does not read as a losing month', () => {
    const r = monthlyAccountReturns(book, account - 5000, [{ date: '2026-03-10', amount: -5000 }], '2026-03-31');
    assert.ok(r.get('2026-03').pct > 0, 'taking money out was booked as a loss');
  });

  test('the month still running is measured to today, not to a future date', () => {
    const r = monthlyAccountReturns(book, account, [], '2026-03-12');
    assert.equal(r.get('2026-03').to, '2026-03-12');
  });

  test('a position still held says so, so the marking is not silent', () => {
    const r = monthlyAccountReturns(book, account, [], '2026-03-31');
    assert.equal(r.get('2026-03').marked, 1);
    assert.equal(r.get('2026-01').marked, 0);
  });

  test('an account with no capital behind it reports nothing, not a number', () => {
    const r = monthlyAccountReturns(book, 1500, [], '2026-03-31');
    assert.equal(r.get('2025-12').pct, null);
  });

  test('an empty book has no months', () => {
    assert.equal(monthlyAccountReturns([], 10000, [], '2026-03-31').size, 0);
  });

  test('it does not depend on recorded account values at all', () => {
    // The old version read daily snapshots, which only start the day the app is
    // installed and whose first weeks are the install settling rather than the
    // market — positions still being entered read as a 22% month.
    const r = monthlyAccountReturns(book, account, [], '2026-03-31');
    assert.ok(r.get('2026-01').pct < 6, `January came out at ${r.get('2026-01').pct}%`);
  });

  test('the two columns tell different stories about the same month', () => {
    // Two trades that doubled, on a small slice of a large account.
    const big = [closed(100, 200, 5, '2026-08-01', '2026-08-20'), closed(100, 200, 5, '2026-08-02', '2026-08-21')];
    assert.equal(avgTradeReturn(big), 100);
    const r = monthlyAccountReturns(big, 101000, [], '2026-08-31');
    assert.equal(round(r.get('2026-08').pct), 1);
  });

  test('it agrees with the account the rest of the app reports', () => {
    const cash = 1500;
    const positions = [closed(100, 120, 50, '2025-12-10', '2026-01-20'), open(100, 130, 40, '2026-03-05')];
    const { account: nlv } = accountTotals(positions, cash);
    const r = monthlyAccountReturns(positions, nlv, [], '2026-03-31');
    assert.equal(round(r.get('2026-03').closing), round(nlv));
  });
});

describe('the month an account is opened', () => {
  /**
   * An account founded inside the range has nothing before its first transfer,
   * so chaining that transfer out of the base leaves whatever rounding residue
   * is lying around and the month divides by it. The demo book opens with
   * $42,000 on 5 January against a first trade on the 6th, and January reported
   * 2,548%.
   */
  const book = [
    closed(100, 120, 50, '2026-01-06', '2026-01-20'),   // +1,000 in January
    closed(100, 110, 50, '2026-02-02', '2026-02-25'),   //   +500 in February
  ];
  const founding = [{ date: '2026-01-05', amount: 20_000 }];
  const account = 21_500;

  test('is measured against the capital it was opened with', () => {
    const r = monthlyAccountReturns(book, account, founding, '2026-02-28');
    assert.equal(round(r.get('2026-01').base), 20_000);
    assert.equal(round(r.get('2026-01').pct), 5);       // 1,000 on 20,000
  });

  test('and the card still says what the account really held that morning', () => {
    // The base is not the opening balance and must not be reported as one: on
    // 1 January this account held nothing.
    const r = monthlyAccountReturns(book, account, founding, '2026-02-28');
    assert.equal(round(r.get('2026-01').opening), 0);
    assert.equal(round(r.get('2026-01').founding), 20_000);
  });

  test('every later month is unaffected by any of it', () => {
    const r = monthlyAccountReturns(book, account, founding, '2026-02-28');
    assert.equal(round(r.get('2026-02').founding), 0);
    assert.equal(round(r.get('2026-02').base), round(r.get('2026-02').opening));
    assert.equal(round(r.get('2026-02').pct), round(500 / 21_000 * 100));
  });

  test('and a deposit into the running account still moves nothing', () => {
    const later = [...founding, { date: '2026-02-10', amount: 9000 }];
    const a = monthlyAccountReturns(book, account, founding, '2026-02-28');
    const b = monthlyAccountReturns(book, account + 9000, later, '2026-02-28');
    for (const key of ['2026-01', '2026-02']) {
      assert.ok(Math.abs(a.get(key).pct - b.get(key).pct) < 1e-9,
        `${key}: ${a.get(key).pct} vs ${b.get(key).pct}`);
    }
  });

  test('with no trades there is no founding date and nothing is special-cased', () => {
    // Flow dates alone still define the range, so the months exist. What must
    // not happen is money being called founding capital on a book that never
    // placed a trade for it to have founded.
    const r = monthlyAccountReturns([], 20_000, founding, '2026-02-28');
    assert.deepEqual([...r.keys()].sort(), ['2026-01', '2026-02']);
    assert.equal(r.get('2026-01').founding, 0);
    assert.equal(round(r.get('2026-01').opening), 0);
    assert.equal(r.get('2026-01').pct, null, 'no capital and no trades is not a return');
  });
});

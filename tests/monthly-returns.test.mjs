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
import { avgTradeReturn } from '../src/core/portfolio.js';
import { monthlyReturns } from '../src/core/portfolioHistory.js';
import { readFileSync } from 'node:fs';

const closed = (entry, exit, qty, open, close) => ({
  status: 'Closed', dir: 'Long', entry, cur: exit, qty, open, close,
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

/** The account valued every day from `start`: `value(i)` for day i, money paid in on given days. */
function history(start, days, value, paid = {}) {
  const rows = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    const date = d.toISOString().slice(0, 10);
    rows.push({ date, totalAccountValue: value(i, date), externalCashFlow: paid[date] ?? 0 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return rows;
}
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// November 2026 audit: a month's portfolio return is the account's days compounded, not realised P&L over a back-worked opening.
describe('the portfolio return, month by month', () => {
  test('the days of the month compounded, from the close before it', () => {
    // 10,000 on 31 January, then +0.1% every day through February.
    const rows = history('2026-01-31', 29, (i) => 10_000 * 1.001 ** i);
    const feb = monthlyReturns(rows).get('2026-02');
    assert.ok(near(feb.returnPct, (1.001 ** 28 - 1) * 100), `${feb.returnPct}`);
    assert.ok(near(feb.pnl, 10_000 * (1.001 ** 28 - 1), 1e-6));
    assert.equal(feb.startValue, 10_000);
    assert.equal(feb.partial, false);
  });

  test('a deposit is not profit, and when it landed changes nothing', () => {
    const flat = history('2026-02-28', 32, () => 10_000);
    const early = history('2026-02-28', 32, (i) => (i >= 3 ? 15_000 : 10_000), { '2026-03-03': 5_000 });
    const late = history('2026-02-28', 32, (i) => (i >= 25 ? 15_000 : 10_000), { '2026-03-25': 5_000 });
    for (const rows of [flat, early, late]) {
      const mar = monthlyReturns(rows).get('2026-03');
      assert.ok(near(mar.returnPct, 0), `${mar.returnPct}`);
      assert.ok(near(mar.pnl, 0));
    }
    assert.equal(monthlyReturns(early).get('2026-03').paidIn, 5_000);
  });

  test('a withdrawal does not read as a losing month', () => {
    const rows = history('2026-02-28', 32, (i) => (i >= 10 ? 7_000 : 10_000), { '2026-03-10': -3_000 });
    assert.ok(near(monthlyReturns(rows).get('2026-03').returnPct, 0));
  });

  test("an open position's move counts: the month is what the account did, not only what was sold", () => {
    // Nothing sold, the holding up 5% over March: the account made 5%.
    const rows = history('2026-02-28', 32, (i) => (i >= 15 ? 10_500 : 10_000));
    assert.ok(near(monthlyReturns(rows).get('2026-03').returnPct, 5));
  });

  test('the month an account opens runs from its first day, and says so', () => {
    const rows = history('2026-03-14', 20, (i) => (i === 0 ? 0 : 10_000 * (1 + 0.01 * (i >= 5))), { '2026-03-15': 10_000 });
    const mar = monthlyReturns(rows).get('2026-03');
    assert.equal(mar.partial, true);
    assert.ok(near(mar.returnPct, 1), `${mar.returnPct}`);
    assert.equal(mar.startValue, 10_000, 'the opening deposit is the base, not a gain');
  });

  test('no daily values, no months', () => {
    assert.equal(monthlyReturns([]).size, 0);
    assert.equal(monthlyReturns(undefined).size, 0);
  });
});

describe('the page keeps the two apart', () => {
  test('trades P&L and the average trade beside the account P&L and its return, never one number for both', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /<th[^>]*>Trades P&L<\/th><th[^>]*>Avg trade %<\/th><th>Trades<\/th><th[^>]*>Account P&L<\/th><th[^>]*>Account %<\/th>/);
    const view = readFileSync(new URL('../src/ui/views/monthly.js', import.meta.url), 'utf8');
    assert.match(view, /monthlyReturns\(forward\.length \? forward : portfolioHistory\(\)\)/);
    assert.doesNotMatch(view, /monthlyAccountReturns|unreal\(/);
  });
});

describe('the win rate', () => {
  test('a trade closed flat is neither a win nor a loss', async () => {
    const { accountTotals, outcomeOf } = await import('../src/core/portfolio.js');
    const book = [
      closed(100, 110, 1, '2026-01-02', '2026-01-05'),
      closed(100, 90, 1, '2026-01-02', '2026-01-06'),
      closed(100, 100, 1, '2026-01-02', '2026-01-07'),
    ];
    const t = accountTotals(book, 0);
    assert.equal(t.wins, 1);
    assert.equal(t.losses, 1);
    assert.equal(t.winRate, 50, 'one of two decided trades, not one of three');
    assert.equal(outcomeOf(0.004), 'even');
    assert.equal(outcomeOf(-0.01), 'loss');
  });
});

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
import { avgTradeReturn, monthPortfolioReturn } from '../src/core/portfolio.js';

const trade = (entry, exit, qty, close = '2026-08-10') => ({
  status: 'Closed', dir: 'Long', entry, cur: exit, qty, close,
});

describe('the average trade return', () => {
  test('counts each trade once, whatever it was sized at', () => {
    // Two winners of 10% on tiny size and one loser of -20% on huge size. By
    // dollars this month is a disaster; by decision quality it is mixed.
    const avg = avgTradeReturn([
      trade(100, 110, 1),
      trade(100, 110, 1),
      trade(100, 80, 1000),
    ]);
    assert.equal(Math.round(avg * 100) / 100, 0);
  });

  test('is not the month P&L over the month capital', () => {
    const trades = [trade(100, 110, 1), trade(100, 80, 1000)];
    const avg = avgTradeReturn(trades);
    const pnl = 10 + -20000;
    const cost = 100 + 100000;
    const weighted = (pnl / cost) * 100;
    assert.equal(Math.round(avg * 10) / 10, -5);
    assert.equal(Math.round(weighted * 10) / 10, -20);
  });

  test('a short is measured in its own direction', () => {
    const short = { status: 'Closed', dir: 'Short', entry: 100, cur: 90, qty: 10 };
    assert.equal(avgTradeReturn([short]), 10);
  });

  test('nothing to average is absent, not flat', () => {
    assert.equal(avgTradeReturn([]), null);
    assert.equal(avgTradeReturn([trade(0, 10, 5)]), null);
  });
});

describe('the portfolio return', () => {
  const snaps = [
    { date: '2026-07-31', value: 10000 },
    { date: '2026-08-14', value: 10500 },
    { date: '2026-08-31', value: 11000 },
    { date: '2026-09-30', value: 12000 },
  ];

  test('is the account move across the month', () => {
    const r = monthPortfolioReturn(snaps, [], '2026-08', '2026-09-30');
    assert.equal(r.from, '2026-07-31');
    assert.equal(r.to, '2026-08-31');
    assert.equal(r.pnl, 1000);
    assert.equal(Math.round(r.pct * 100) / 100, 10);
    assert.equal(r.partial, false);
  });

  test('a deposit is not profit', () => {
    // The account rose 1,000 but 900 of it was paid in on the 16th. Counting
    // the balance change alone reports 10% where the account made about 1%.
    const flows = [{ date: '2026-08-16', amount: 900 }];
    const r = monthPortfolioReturn(snaps, flows, '2026-08', '2026-09-30');
    assert.equal(r.pnl, 100);
    assert.ok(r.pct > 0.9 && r.pct < 1.1, `unexpected ${r.pct}`);
  });

  test('a deposit is weighted by how much of the month it was there', () => {
    // Same money, arriving on the last day. It did almost no work, so it barely
    // enlarges the base and the return reads higher than the early deposit's.
    const early = monthPortfolioReturn(snaps, [{ date: '2026-08-01', amount: 900 }], '2026-08', '2026-09-30');
    const late = monthPortfolioReturn(snaps, [{ date: '2026-08-30', amount: 900 }], '2026-08', '2026-09-30');
    assert.equal(early.pnl, late.pnl);
    assert.ok(late.pct > early.pct, `${late.pct} should exceed ${early.pct}`);
  });

  test('a withdrawal is not a loss', () => {
    const out = [
      { date: '2026-07-31', value: 10000 },
      { date: '2026-08-31', value: 9500 },
    ];
    const r = monthPortfolioReturn(out, [{ date: '2026-08-10', amount: -1000 }], '2026-08', '2026-09-01');
    assert.equal(r.pnl, 500);
    assert.ok(r.pct > 0, 'taking money out read as a losing month');
  });

  test('a flow on the opening day is already inside the opening balance', () => {
    const r = monthPortfolioReturn(snaps, [{ date: '2026-07-31', amount: 900 }], '2026-08', '2026-09-30');
    assert.equal(r.pnl, 1000);
  });

  test('a stale opening point is not dragged across a gap', () => {
    // June's closing value is not August's opening value. Using it would hand
    // August everything July did.
    const gappy = [
      { date: '2026-06-30', value: 8000 },
      { date: '2026-08-20', value: 11000 },
      { date: '2026-08-28', value: 11550 },
    ];
    const r = monthPortfolioReturn(gappy, [], '2026-08', '2026-09-01');
    assert.equal(r.from, '2026-08-20');
    assert.equal(Math.round(r.pct * 10) / 10, 5);
    assert.equal(r.partial, true, 'a part-month should say so');
  });

  test('a month the account was never valued in is absent, not zero', () => {
    assert.equal(monthPortfolioReturn(snaps, [], '2026-03', '2026-09-30'), null);
  });

  test('one lone point is not a return', () => {
    assert.equal(monthPortfolioReturn([{ date: '2026-08-31', value: 10000 }], [], '2026-08'), null);
  });

  test('unsorted and malformed points do not break it', () => {
    const messy = [
      { date: '2026-08-31', value: 11000 },
      null,
      { date: '2026-07-31', value: 10000 },
      { date: '2026-08-14', value: NaN },
    ];
    const r = monthPortfolioReturn(messy, [], '2026-08', '2026-09-30');
    assert.equal(Math.round(r.pct * 100) / 100, 10);
  });

  test('the two answers are independent, which is the reason for both', () => {
    // A perfect month of trading on a small slice of a large, flat book.
    const book = [
      { date: '2026-07-31', value: 100000 },
      { date: '2026-08-31', value: 101000 },
    ];
    const trades = [trade(100, 150, 20), trade(100, 150, 20)];
    assert.equal(avgTradeReturn(trades), 50);
    assert.equal(Math.round(monthPortfolioReturn(book, [], '2026-08', '2026-09-01').pct * 10) / 10, 1);
  });
});

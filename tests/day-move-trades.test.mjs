/**
 * The day's move when shares were bought or sold that day, and on weekends.
 *
 * Reported: the app showed +1.68% for Friday 18 September 2026, IBKR +2.12%
 * (+$970.80 on $45,858.44). 140 ETHA were sold that day and had moved $204
 * before they went; a statement keeps the sale as proceeds, with no previous
 * close, so it was left out. It was also a Saturday, and a sale dated Friday
 * was not "today".
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { dailyPortfolioMove } from '../src/core/portfolio.js';
import { tradingDay } from '../src/config/marketCalendar.js';

const pos = (ticker, qty, cur, prevClose, extra = {}) => ({
  ticker, qty, cur, prevClose, entry: prevClose, status: 'Open', dir: 'Long', cls: 'Stocks', open: '2026-02-03', ...extra,
});
const trade = (ticker, qty, price, cash) => ({ date: '2026-09-18', kind: 'trade', ticker, qty, price, cash });

describe('the trading day', () => {
  test('Saturday and Sunday belong to Friday; a weekday to itself', () => {
    assert.equal(tradingDay(new Date('2026-09-19T12:00:00Z')), '2026-09-18');
    assert.equal(tradingDay(new Date('2026-09-20T12:00:00Z')), '2026-09-18');
    assert.equal(tradingDay(new Date('2026-09-21T14:00:00Z')), '2026-09-21');
  });

  test("New York's date, not the local one: Friday night in Israel is still Friday", () => {
    assert.equal(tradingDay(new Date('2026-09-18T22:30:00Z')), '2026-09-18');
  });
});

describe('shares traded on the day', () => {
  test('a sale counts from the previous close to its price, less its fee — the ETHA case', () => {
    const positions = [pos('ETHA', 151, 19.92, 18.47)];
    const trades = [trade('ETHA', -100, 19.925, 1991.4391545), trade('ETHA', -40, 19.94, 796.57564944)];
    const m = dailyPortfolioMove(positions, 10_000, '2026-09-18', trades);
    // 151 × 1.45 held, plus 100 × 1.455 and 40 × 1.47 sold, less $2.09 of fees.
    const expected = 151 * (19.92 - 18.47) + (100 * 19.925 - 1.0608455 - 100 * 18.47) + (40 * 19.94 - 1.02435056 - 40 * 18.47);
    assert.ok(Math.abs(m.dollars - expected) < 1e-6, `got ${m.dollars}, expected ${expected}`);
    assert.ok(Math.abs(m.sold - (expected - 151 * 1.45)) < 1e-6);
  });

  test('without the ledger the sale is missed, which is the bug', () => {
    const positions = [pos('ETHA', 151, 19.92, 18.47)];
    assert.ok(Math.abs(dailyPortfolioMove(positions, 10_000, '2026-09-18', []).dollars - 151 * 1.45) < 1e-9);
  });

  test('shares bought on the day count from the price paid, not from the close', () => {
    const positions = [pos('AMD', 15, 110, 100)];
    const m = dailyPortfolioMove(positions, 10_000, '2026-09-18', [trade('AMD', 5, 105, -525)]);
    // 10 held from 100 to 110, 5 bought at 105 to 110.
    assert.ok(Math.abs(m.dollars - (10 * 10 + 5 * 5)) < 1e-9, `got ${m.dollars}`);
  });

  test('a short opened on the day gains as the price falls from where it was sold', () => {
    const positions = [pos('USO', 8, 150, 155, { dir: 'Short' })];
    const m = dailyPortfolioMove(positions, 10_000, '2026-09-18', [trade('USO', -8, 154, 8 * 154)]);
    assert.ok(Math.abs(m.dollars - 8 * (154 - 150)) < 1e-9, `got ${m.dollars}`);
  });

  test("another day's trades change nothing", () => {
    const positions = [pos('ETHA', 151, 19.92, 18.47)];
    const old = { ...trade('ETHA', -100, 19.925, 1991.44), date: '2026-09-17' };
    assert.ok(Math.abs(dailyPortfolioMove(positions, 10_000, '2026-09-18', [old]).dollars - 151 * 1.45) < 1e-9);
  });
});

describe('money paid in or out on the day', () => {
  // $20,000 of shares up $200 on the day, and $5,000 deposited that day, so the
  // account now reads $25,200. The day was +1.0% on the $20,000 that was at risk.
  const positions = [pos('SPY', 100, 202, 200)];
  const deposit = (cash, date = '2026-09-18') => ({ date, kind: 'flow', cash });

  test("a deposit made that day is not counted as capital the day's move was earned on", () => {
    const m = dailyPortfolioMove(positions, 25_200, '2026-09-18', [deposit(5_000)]);
    assert.equal(m.dollars, 200);
    assert.ok(Math.abs(m.percent - 1.0) < 1e-9, `got ${m.percent}%, expected 1.00%`);
  });

  test('without the fix the same day read +0.8% — dollars right, percentage low', () => {
    const m = dailyPortfolioMove(positions, 25_200, '2026-09-18', []);
    assert.ok(Math.abs(m.percent - 200 / 25_000 * 100) < 1e-9);
  });

  test('a withdrawal that day is added back: it was in the account at the open', () => {
    // $30,200 at risk... then $10,000 taken out, leaving $20,200 showing.
    const m = dailyPortfolioMove(positions, 20_200, '2026-09-18', [deposit(-10_000)]);
    assert.ok(Math.abs(m.percent - 200 / 30_000 * 100) < 1e-9);
  });

  test("a deposit on another day changes nothing about today's percentage", () => {
    const m = dailyPortfolioMove(positions, 20_200, '2026-09-18', [deposit(5_000, '2026-09-10')]);
    assert.ok(Math.abs(m.percent - 1.0) < 1e-9);
  });
});

/**
 * "Today" is New York's date, everywhere, or nothing lines up.
 *
 * `todayStr()` read UTC while every other date in the app is a New York market
 * date. They agree for most of the day and part company every weekday evening
 * once New York passes eight o'clock — which is exactly when someone sits down
 * to write up their day, and several hours earlier than the machine this was
 * built on ever noticed.
 *
 * Two things broke, both only after dinner and both only for the people the app
 * was not built beside:
 *
 *   a withdrawal entered at 9pm in New York was stamped tomorrow, so the day's
 *   move never matched it, and $200 made on a $10,000 account read +2.86%
 *
 *   a trade opened through the form took tomorrow's date too, so it was no
 *   longer "bought today" and was measured from yesterday's close instead of
 *   from the price paid: $50 of a $100 move
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { todayStr, dailyDollar, dailyPortfolioMove, accountTotals } from '../src/core/portfolio.js';
import { tradingDay } from '../src/config/marketCalendar.js';
import { withManualFlows } from '../src/core/portfolioHistory.js';

const RealDate = Date;
/** Hold the clock at one instant, so a test can stand in another timezone. */
function at(iso) {
  globalThis.Date = class extends RealDate {
    constructor(...args) { return args.length ? new RealDate(...args) : new RealDate(iso); }
    static now() { return new RealDate(iso).getTime(); }
  };
}
afterEach(() => { globalThis.Date = RealDate; });

describe('the two clocks agree', () => {
  const instants = [
    ['2026-09-23T16:00:00Z', 'midday in New York'],
    ['2026-09-23T23:30:00Z', 'half past seven in the evening'],
    ['2026-09-24T01:00:00Z', 'nine in the evening — UTC is already tomorrow'],
    ['2026-09-24T03:45:00Z', 'quarter to midnight'],
    ['2026-09-26T02:00:00Z', 'ten on a Friday night — UTC is already Saturday'],
    ['2026-09-23T22:00:00Z', 'one in the morning in Israel, still Wednesday in New York'],
  ];

  for (const [iso, when] of instants) {
    test(`at ${when}`, () => {
      at(iso);
      assert.equal(todayStr(), tradingDay(), `${iso}: the app stamps one date and measures another`);
    });
  }
});

describe('what the mismatch cost', () => {
  // Nine in the evening in New York, when UTC has already rolled over.
  const EVENING = '2026-09-24T01:00:00Z';

  test('a withdrawal entered in the evening still counts as today', () => {
    at(EVENING);
    // $10,000 that made $200 today, then $3,000 taken out.
    const up = { status: 'Open', dir: 'Long', cls: 'Stocks', ticker: 'A', qty: 100, entry: 98, cur: 102, prevClose: 100 };
    const account = accountTotals([up], 0).account - 3000;
    const events = withManualFlows([], [{ date: todayStr(), amount: -3000, manual: true }]);
    const move = dailyPortfolioMove([up], account, undefined, events);
    // On the $10,000 the account held at the open, not on the $7,000 left after.
    assert.ok(Math.abs(move.percent - 2) < 1e-9, `${move.percent}% — it read 2.857% when the stamp was UTC`);
  });

  test('a trade opened in the evening is measured from the price paid', () => {
    at(EVENING);
    // 10 shares bought today at $90, now $100; yesterday's close was $95.
    const bought = {
      status: 'Open', dir: 'Long', cls: 'Stocks', ticker: 'B',
      qty: 10, entry: 90, cur: 100, prevClose: 95, open: todayStr(),
    };
    assert.equal(dailyDollar(bought), 100, 'it credited 50 — yesterday\'s close — when the stamp was UTC');
  });

  test('and a crypto holding, whose day is the calendar day, agrees too', () => {
    at(EVENING);
    const btc = { status: 'Open', dir: 'Long', cls: 'Crypto', ticker: 'BTC', qty: 1, entry: 50_000, cur: 60_000, open: todayStr() };
    assert.equal(dailyDollar(btc), 10_000);
  });
});

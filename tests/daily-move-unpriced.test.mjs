/**
 * The day's move when part of the account has no price for today.
 *
 * Reported as "some people's daily return is off" while the same book read
 * correctly here — the tell that it depends on whose tickers the price service
 * carries. A holding with no previous close contributes nothing to the day's
 * dollars, which is right; but its whole value stayed in the balance the day
 * was measured against, so it dragged the percentage towards zero in
 * proportion to its size. Eight tickers up 2% beside one unquoted holding ten
 * times their size read +0.15%.
 *
 * The same hole swallowed sales. A statement keeps a sale as its proceeds with
 * no previous close, so a position sold out entirely today could not be priced
 * — and the cash it became was still in the base.
 *
 * So the day is measured over the part of the account that was actually priced
 * for it. The dollars were never wrong; the base was.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { dailyPortfolioMove, accountTotals, unpricedExits } from '../src/core/portfolio.js';
import { tradingDay } from '../src/config/marketCalendar.js';

const TODAY = tradingDay();
const open = (o) => ({ status: 'Open', dir: 'Long', cls: 'Stocks', entry: 100, ...o });
/** Eight holdings, every one up exactly 2% today: $8,000 that became $8,160. */
const quoted = () => Array.from({ length: 8 }, (_, i) => open({
  ticker: `Q${i}`, qty: 10, cur: 102, prevClose: 100,
}));

const moveOf = (positions, cash = 0, events = []) => dailyPortfolioMove(
  positions, accountTotals(positions, cash).account, undefined, events,
);

describe('a holding the price service never quoted', () => {
  test('does not drag the day towards zero', () => {
    // Two holdings with neither a previous close nor a quoted change.
    const dark = [open({ ticker: 'U1', qty: 10, cur: 100 }), open({ ticker: 'U2', qty: 10, cur: 100 })];
    const move = moveOf([...quoted(), ...dark]);
    assert.ok(Math.abs(move.percent - 2) < 1e-9, `${move.percent}%`);
    assert.ok(Math.abs(move.dollars - 160) < 1e-9, `${move.dollars}`);
    // Still said plainly: two holdings are not in the figure.
    assert.equal(move.pending, 2);
  });

  test('however large it is beside the rest', () => {
    // $100,000 unquoted against $8,000 quoted — the case that read +0.15%.
    const whale = open({ ticker: 'B1', qty: 1000, cur: 100 });
    const move = moveOf([...quoted(), whale]);
    assert.ok(Math.abs(move.percent - 2) < 1e-9, `${move.percent}%`);
    assert.equal(move.pending, 1);
  });

  test('a fully quoted book is measured exactly as before', () => {
    const move = moveOf(quoted(), 2000);
    // $160 on $10,000 of account: the cash counts, because cash was held all day.
    assert.ok(Math.abs(move.percent - 1.6) < 1e-9, `${move.percent}%`);
    assert.equal(move.pending, 0);
  });

  test('a short with no quote is left out by its own market value, not its cost', () => {
    const short = { status: 'Open', dir: 'Short', cls: 'Stocks', ticker: 'S', qty: 20, entry: 50, cur: 40 };
    const move = moveOf([...quoted(), short]);
    assert.ok(Math.abs(move.percent - 2) < 1e-9, `${move.percent}%`);
  });
});

describe('shares sold today that nobody could price', () => {
  /** An imported sale: the statement gives the proceeds and no previous close. */
  const soldOut = {
    status: 'Closed', dir: 'Long', cls: 'Stocks', ticker: 'S1', qty: 100, entry: 50, cur: 60,
    open: '2026-01-05', close: TODAY,
    exits: [{ d: TODAY, qty: 100, price: 60, pnl: 1000, pct: 20, prevClose: null }],
  };

  test('their proceeds come out of the base too', () => {
    // $6,000 of cash arrived from a sale the day could not be measured over.
    const move = moveOf([...quoted(), soldOut], 6000);
    assert.ok(Math.abs(move.percent - 2) < 1e-9, `${move.percent}%`);
    assert.ok(Math.abs(move.sold) < 1e-9, 'the sale itself still contributes nothing');
  });

  test('the same holds when the ledger carries the trade but nothing is left to price it against', () => {
    const events = [{ date: TODAY, at: `${TODAY} 10:00:00`, kind: 'trade', ticker: 'S1', qty: -100, price: 60, cash: 6000 }];
    const move = moveOf([...quoted(), soldOut], 6000, events);
    assert.ok(Math.abs(move.percent - 2) < 1e-9, `${move.percent}%`);
  });

  test('a sale that can be priced is counted, and its proceeds stay in the base', () => {
    const priced = { ...soldOut, exits: [{ d: TODAY, qty: 100, price: 60, pnl: 1000, pct: 20, prevClose: 58 }] };
    const move = moveOf([...quoted(), priced], 6000);
    // 100 shares moved $58 → $60 before they went: $200, plus $160 held.
    assert.ok(Math.abs(move.sold - 200) < 1e-9, `${move.sold}`);
    assert.ok(Math.abs(move.dollars - 360) < 1e-9, `${move.dollars}`);
    // On $13,800 held at yesterday's close: $8,000 quoted + $5,800 of S1.
    assert.ok(Math.abs(move.percent - (360 / 13_800) * 100) < 1e-9, `${move.percent}%`);
    assert.equal(unpricedExits(priced, TODAY), 0);
  });

  test('shares bought and sold the same day need no previous close', () => {
    const sameDay = { ...soldOut, open: TODAY };
    assert.equal(unpricedExits(sameDay, TODAY), 0);
  });

  test('yesterday\'s sales are not today\'s business', () => {
    const older = { ...soldOut, exits: [{ d: '2026-01-06', qty: 100, price: 60, prevClose: null }] };
    assert.equal(unpricedExits(older, TODAY), 0);
  });
});

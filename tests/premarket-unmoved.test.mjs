/**
 * Pre-market: a holding that has not traded today has moved nothing today.
 *
 * Between four and half past nine in New York — eleven in the morning to half
 * past four in Israel — the regular feed cannot be trusted for the day's move.
 * A quote gives the last trade and the previous close, and before anything has
 * traded today those are yesterday's close and the day before it. The
 * percentage it implies is *yesterday's move*, served as though it were
 * today's.
 *
 * Only the symbols actually printing in pre-market have a real figure, and the
 * extended feed corrects those. Everything else was left carrying yesterday,
 * so the portfolio read a whole session of movement that had already happened.
 * On a real book that was −1.04% where Interactive Brokers read −0.60%.
 *
 * The correction is zero, not "no figure". The shares are still worth what they
 * closed at, so their full value belongs in the balance the day is measured
 * against — which is how the broker reports it.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { applyExtendedQuotes } from '../src/services/extendedHours.js';
import { dailyPortfolioMove, accountTotals } from '../src/core/portfolio.js';

/** 04:50 in New York — pre-market, before the opening bell. */
const PRE = new Date('2026-09-24T08:50:00Z');
/** 11:00 in New York — the regular session, where the feed is correct again. */
const OPEN = new Date('2026-09-24T15:00:00Z');
/** 21:00 in New York — after hours has ended and the day is held. */
const OVER = new Date('2026-09-24T01:00:00Z');

const held = (ticker, qty, cur, yesterdaysMove) => ({
  status: 'Open', dir: 'Long', cls: 'Stocks', ticker, qty, entry: cur, cur,
  dailyChg: yesterdaysMove,
  prevClose: cur / (1 + yesterdaysMove / 100),
});

let book;
beforeEach(() => {
  // $10,000 of stock: nine holdings carrying a −2% day that is already over,
  // and one that really is trading this morning.
  book = [
    ...Array.from({ length: 9 }, (_, i) => held(`S${i}`, 10, 100, -2)),
    held('MOVER', 10, 100, -2),
  ];
});

const printing = (price) => new Map([['MOVER', {
  phase: 'pre', price, regularClose: 100, previousClose: 102,
}]]);

describe('in pre-market', () => {
  test("the holdings that have not traded stop carrying yesterday's move", () => {
    applyExtendedQuotes(book, printing(99), PRE);
    for (const p of book.slice(0, 9)) {
      assert.equal(p.dailyChg, 0, `${p.ticker} is still carrying a day that is over`);
      assert.equal(p.prevClose, p.cur, 'and it is measured from its own close, so it reads zero');
    }
  });

  test('the one that is trading keeps its real move, measured from yesterday\'s close', () => {
    applyExtendedQuotes(book, printing(99), PRE);
    const mover = book[9];
    assert.equal(mover.extPhase, 'pre');
    assert.equal(mover.cur, 99);
    assert.equal(mover.prevClose, 100, "yesterday's regular close, not the one before it");
    assert.ok(Math.abs(mover.dailyChg + 1) < 1e-9, `${mover.dailyChg}`);
  });

  test('so the portfolio reads what has actually happened this morning', () => {
    const account = accountTotals(book, 0).account;
    const stale = dailyPortfolioMove(book.map((p) => ({ ...p })), account, undefined, []);
    applyExtendedQuotes(book, printing(99), PRE);
    const real = dailyPortfolioMove(book, accountTotals(book, 0).account, undefined, []);

    // Before: ten holdings each showing −2% — a whole session already finished.
    assert.ok(Math.abs(stale.percent + 2) < 1e-6, `${stale.percent}%`);
    // After: one holding down $1 a share on $10,000 of account.
    assert.ok(Math.abs(real.dollars + 10) < 1e-6, `${real.dollars}`);
    assert.ok(Math.abs(real.percent + 0.1) < 1e-3, `${real.percent}%`);
  });

  test('the untouched holdings stay in the base — they are worth what they closed at', () => {
    applyExtendedQuotes(book, printing(99), PRE);
    const move = dailyPortfolioMove(book, accountTotals(book, 0).account, undefined, []);
    assert.equal(move.pending, 0, 'zero is a figure, so nothing is pending');
  });

  test('and with no extended feed at all, nothing carries yesterday either', () => {
    assert.equal(applyExtendedQuotes(book, new Map(), PRE), true);
    assert.ok(book.every((p) => p.dailyChg === 0));
  });

  test('crypto is untouched, because its day never ended', () => {
    const coin = { ...held('BTC', 1, 50_000, 5), cls: 'Crypto' };
    applyExtendedQuotes([coin], new Map(), PRE);
    assert.equal(coin.dailyChg, 5);
  });
});

describe('outside that window nothing changes', () => {
  test('in the regular session the feed is correct and is left alone', () => {
    applyExtendedQuotes(book, new Map(), OPEN);
    assert.ok(book.every((p) => p.dailyChg === -2), 'a real −2% day in progress must survive');
  });

  test('once the day is over the figures are held, as before', () => {
    assert.equal(applyExtendedQuotes(book, new Map(), OVER), false);
    assert.ok(book.every((p) => p.dailyChg === -2));
  });

  test('on a weekend morning there is no pre-market to be before', () => {
    applyExtendedQuotes(book, new Map(), new Date('2026-09-26T12:50:00Z'));
    assert.ok(book.every((p) => p.dailyChg === -2));
  });
});

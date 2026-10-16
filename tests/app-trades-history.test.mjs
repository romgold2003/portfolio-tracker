/**
 * Trades entered in the app after the last statement belong in the history.
 *
 * The daily history walks forward from the statements and stopped at their
 * closing date, holding the statement's shares while the account went on
 * trading. Checked on Romy's real books: the September 30 statement plus the
 * three trades of 14 October (two SOFI buys, one ORCL) entered as the app
 * records them rebuilds 14 October at $45,061 against IBKR's $45,072; without
 * them it read $45,255 and the day −3.09% where it was −3.51%.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { appTradeEvents } from '../src/core/appTrades.js';
import { buildPortfolioHistory } from '../src/core/portfolioHistory.js';

const END = '2026-10-14';

describe('what the app recorded, as dated trades', () => {
  test('a top-up and a sale after the statement; nothing on or before it', () => {
    const sofi = {
      ticker: 'SOFI', dir: 'Long', status: 'Open', open: '2026-03-02', entry: 15, qty: 693,
      adds: [{ d: '2026-09-23', qty: 90, price: 16.83 }, { d: '2026-10-15', qty: 200, price: 14.91 }],
      exits: [{ d: '2026-10-16', qty: 50, price: 15.2 }],
    };
    assert.deepEqual(appTradeEvents([sofi], END), [
      { date: '2026-10-15', ticker: 'SOFI', qty: 200, price: 14.91, cash: -2982, kind: 'trade' },
      { date: '2026-10-16', ticker: 'SOFI', qty: -50, price: 15.2, cash: 760, kind: 'trade' },
    ]);
  });

  test('a holding opened after the statement: its first purchase, apart from its top-ups', () => {
    // 10 bought at 100, 10 more at 110: average 105, 20 held.
    const p = { ticker: 'NEW', dir: 'Long', status: 'Open', open: '2026-10-15', entry: 105, qty: 20,
      adds: [{ d: '2026-10-16', qty: 10, price: 110 }] };
    const [first, add] = appTradeEvents([p], END);
    assert.equal(first.date, '2026-10-15');
    assert.equal(first.qty, 10);
    assert.ok(Math.abs(first.price - 100) < 1e-9);
    assert.equal(add.qty, 10);
  });

  test('one opened and closed since: bought, then sold, holding nothing', () => {
    const p = { ticker: 'FLIP', dir: 'Long', status: 'Closed', open: '2026-10-15', entry: 50, qty: 10,
      exits: [{ d: '2026-10-16', qty: 10, price: 55 }] };
    const events = appTradeEvents([p], END);
    assert.equal(events.reduce((s, e) => s + e.qty, 0), 0);
    assert.equal(events.reduce((s, e) => s + e.cash, 0), 50);
  });

  test('a short is sold first and bought back', () => {
    const p = { ticker: 'USO', dir: 'Short', status: 'Open', open: '2026-10-15', entry: 150, qty: 8,
      exits: [{ d: '2026-10-16', qty: 3, price: 140 }] };
    const [open, cover] = appTradeEvents([p], END);
    assert.deepEqual([open.qty, open.cash], [-11, 1650]);
    assert.deepEqual([cover.qty, cover.cash], [3, -420]);
  });

  test('a holding the statement carried in is never bought a second time', () => {
    const p = { ticker: 'AMD', dir: 'Long', status: 'Open', open: '2026-10-15', carriedIn: true, entry: 126, qty: 10 };
    assert.deepEqual(appTradeEvents([p], END), []);
  });
});

describe('in the walk', () => {
  test('a purchase after the statement is held from its day, and paid for from cash', () => {
    const closes = { '2026-10-14': 15, '2026-10-15': 14.5, '2026-10-16': 15.5 };
    const p = { ticker: 'SOFI', dir: 'Long', status: 'Open', open: '2026-03-02', entry: 15, qty: 300,
      adds: [{ d: '2026-10-15', qty: 200, price: 14.5 }] };
    const values = buildPortfolioHistory({
      opening: { date: END, cash: 5000, holdings: { SOFI: 100 } },
      events: appTradeEvents([p], END),
      priceOn: (t, day) => closes[day] ?? null,
      to: '2026-10-16',
    }).map((r) => r.totalAccountValue);
    // 100 shares and $5,000; then 300 shares and $2,100; then they rise $1 each.
    assert.deepEqual(values, [6500, 6450, 6750]);
  });

  test('both history builds on the main screen are given them', () => {
    const home = readFileSync(new URL('../src/ui/views/home.js', import.meta.url), 'utf8');
    assert.equal((home.match(/\.\.\.appTradeEvents\(/g) ?? []).length, 2);
  });
});

/**
 * The crypto journal: a strategy's trades with money outside the account,
 * entered as the profit, the average entry and the average exit, and read like
 * the Monthly page (October 2026). Reference only — never in the account.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { cleanTrade, derive, overall, monthsOf, yearBars, yearsOf } from '../src/core/cryptoJournal.js';
import { state, loadState, journalSnapshot, setCryptoTrades } from '../src/core/store.js';
import { accountTotals } from '../src/core/portfolio.js';

const trade = (over) => ({ d: '2026-10-14', coin: 'btc', entry: 60_000, exit: 63_000, pnl: 250, ...over });

describe('one trade, from what the exchange shows', () => {
  test('a profit on a rise is a long: +5% in its favour, $5,000 at entry', () => {
    const t = derive(cleanTrade(trade()));
    assert.equal(t.dir, 'Long');
    assert.ok(Math.abs(t.pct - 5) < 1e-9);
    assert.ok(Math.abs(t.size - 5000) < 1e-6);
    assert.equal(t.coin, 'BTC');
    assert.equal(t.win, true);
  });

  test('a profit on a fall is a short, and its move counts in its favour', () => {
    const t = derive(cleanTrade(trade({ entry: 3000, exit: 2850, pnl: 100 })));
    assert.equal(t.dir, 'Short');
    assert.ok(Math.abs(t.pct - 5) < 1e-9);
    assert.ok(Math.abs(t.size - 2000) < 1e-6);
  });

  test('a loss on a rise was a short; a loss on a fall a long', () => {
    assert.equal(derive(cleanTrade(trade({ pnl: -80 }))).dir, 'Short');
    const long = derive(cleanTrade(trade({ entry: 100, exit: 90, pnl: -50 })));
    assert.equal(long.dir, 'Long');
    assert.ok(Math.abs(long.pct - -10) < 1e-9);
    assert.equal(long.loss, true);
  });

  test('without a P&L, an entry, an exit or a date it is not a trade', () => {
    for (const bad of [{ pnl: '' }, { entry: 0 }, { exit: -1 }, { d: '14/10/2026' }]) {
      assert.equal(cleanTrade(trade(bad)), null, JSON.stringify(bad));
    }
  });
});

describe('read like the Monthly page', () => {
  const trades = [
    trade({ d: '2026-10-14', pnl: 250 }), // +5%
    trade({ d: '2026-10-02', entry: 100, exit: 90, pnl: -50 }), // −10%
    trade({ d: '2026-10-20', entry: 100, exit: 102, pnl: 20 }), // +2%
    trade({ d: '2026-09-30', entry: 50, exit: 55, pnl: 30 }), // +10%
  ];

  test('each month: profit, trades, win rate, the average trade, best and worst', () => {
    const [oct, sep] = monthsOf(trades);
    assert.equal(oct.key, '2026-10');
    assert.equal(oct.pnl, 220);
    assert.deepEqual([oct.n, oct.wins, oct.losses], [3, 2, 1]);
    assert.ok(Math.abs(oct.winRate - 200 / 3) < 1e-9);
    assert.ok(Math.abs(oct.avgPct - (5 - 10 + 2) / 3) < 1e-9);
    assert.ok(Math.abs(oct.best.pct - 5) < 1e-9);
    assert.ok(Math.abs(oct.worst.pct - -10) < 1e-9);
    assert.deepEqual(oct.trades.map((t) => t.d), ['2026-10-20', '2026-10-14', '2026-10-02']);
    assert.equal(sep.key, '2026-09');
  });

  test('the year in twelve bars, and everything together', () => {
    const bars = yearBars(trades, 2026);
    assert.equal(bars[9], 220);
    assert.equal(bars[8], 30);
    assert.deepEqual(yearsOf(trades), [2026]);
    const o = overall(trades);
    assert.equal(o.pnl, 250);
    assert.equal(o.winRate, 75);
    assert.ok(Math.abs(o.profitFactor - 300 / 50) < 1e-9);
  });
});

describe('kept, and kept apart', () => {
  test('it survives a save and a sign-in, with the sign-in rather than an account', () => {
    loadState({ positions: [], cash: 1000 });
    setCryptoTrades([trade(), trade({ d: '2026-09-01' })]);
    const saved = journalSnapshot();
    assert.equal(saved.cryptoTrades.length, 2);
    loadState(JSON.parse(JSON.stringify(saved)));
    assert.equal(state.cryptoTrades.length, 2);
    assert.equal(state.cryptoTrades[0].coin, 'BTC');
  });

  test('it is never in the account value', () => {
    loadState({ positions: [], cash: 1000 });
    setCryptoTrades([trade({ pnl: 999_999 })]);
    assert.equal(accountTotals(state.positions, state.cash).account, 1000);
  });

  test('it is a tab of the Crypto page, with its add button', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /data-ctab="journal">Journal</);
    assert.match(html, /id="cryptoJournal" hidden/);
    assert.match(html, /id="cjAdd"[^>]*>\+ Add trade</);
  });
});

describe('the page', () => {
  test('a month row per month, green and red, and the form previews what it will save', async () => {
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    const { monthsHtml, tradesHtml, previewText } = await import('../src/ui/views/cryptoJournal.js');
    const list = [cleanTrade(trade()), cleanTrade(trade({ d: '2026-10-02', entry: 100, exit: 90, pnl: -50 }))];
    const html = monthsHtml(list);
    assert.match(html, /data-month="2026-10"/);
    assert.match(html, /October 2026/);
    assert.match(tradesHtml(list, '2026-10'), /badge b-long">Long[\s\S]*?\+5\.00%[\s\S]*?\+\$250\.00/);
    assert.equal(previewText({ entry: '60000', exit: '63000', pnl: '250' }), 'Long · +5.00% · size at entry ≈ $5,000');
    assert.match(previewText({ entry: '', exit: '1', pnl: '1' }), /Enter the P&L/);
  });
});

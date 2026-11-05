/**
 * State of mind at entry (November 2026): each trade can carry how the trader
 * felt taking it, 1 (emotional / greedy) to 10 (confident), and the Monthly
 * page compares the results of each state of mind.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { cleanMind, mindLabel, mindStats } from '../src/core/mind.js';

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** A closed long: bought `qty` at `entry`, sold at `exit`. */
const closed = (mind, entry, exit, qty = 10) => ({
  ticker: 'T', cls: 'Stocks', dir: 'Long', status: 'Closed', entry, cur: exit, qty, origQty: qty, amount: entry * qty, ...(mind == null ? {} : { mind }),
});

describe('the score', () => {
  test('a whole number from 1 to 10, or not rated', () => {
    assert.equal(cleanMind(7), 7);
    assert.equal(cleanMind('3'), 3);
    for (const bad of [0, 11, 5.5, '', null, undefined, 'calm']) assert.equal(cleanMind(bad), null, String(bad));
  });

  test('1 is emotional and greedy, 10 is confident', () => {
    assert.equal(mindLabel(1), 'Emotional / greedy');
    assert.equal(mindLabel(5), 'Hesitant');
    assert.equal(mindLabel(10), 'Confident');
    assert.equal(mindLabel(null), 'Not rated');
  });
});

describe('results by state of mind', () => {
  test('closed trades grouped emotional / hesitant / confident, unrated apart, open ones left out', () => {
    const { groups, unrated } = mindStats([
      closed(2, 100, 80), // emotional, -20%
      closed(3, 100, 110), // emotional, +10%
      closed(5, 100, 100.5), // hesitant, +0.5%
      closed(8, 100, 130), // confident, +30%
      closed(10, 50, 60), // confident, +20%
      closed(null, 100, 90),
      { ...closed(9, 100, 120), status: 'Open' },
    ]);
    assert.equal(unrated, 1);
    const [emotional, hesitant, confident] = groups;
    assert.equal(emotional.trades, 2);
    assert.equal(emotional.winRate, 50);
    assert.ok(Math.abs(emotional.avgReturn - -5) < 1e-9);
    assert.ok(Math.abs(emotional.pnl - -100) < 1e-9);
    assert.equal(hesitant.trades, 1);
    assert.equal(confident.trades, 2);
    assert.equal(confident.winRate, 100);
    assert.ok(Math.abs(confident.avgReturn - 25) < 1e-9);
    assert.ok(Math.abs(confident.pnl - 400) < 1e-9);
  });

  test('the Monthly card: the three groups, the best one marked; a nudge to rate when none are', async () => {
    const { mindStatsHtml } = await import('../src/ui/views/monthly.js');
    const html = mindStatsHtml([closed(2, 100, 80), closed(8, 100, 130)]);
    assert.match(html, /Emotional \(1–4\)/);
    assert.match(html, /Confident \(7–10\)/);
    assert.match(html, /class="mind-col best" data-group="confident"/);
    assert.match(html, /2 rated closed trades/);
    assert.match(mindStatsHtml([closed(null, 100, 90)]), /Rate your state of mind when you enter a trade/);
  });
});

describe('kept with the trade', () => {
  test('a new trade, a finished one and an edit carry it; a reload keeps it', async () => {
    const store = await import('../src/core/store.js');
    const { addPosition, addClosedPosition, updatePosition } = await import('../src/core/positions.js');
    store.clearState();
    store.loadState({ positions: [], cash: 10000, snapshots: [], priceLog: {}, apiKey: '' });
    const open = addPosition({ ticker: 'MSFT', cls: 'Stocks', dir: 'Long', open: '2026-11-05', entry: 400, amount: 4000, qty: 10, reason: '', mind: 8 });
    assert.equal(open.mind, 8);
    const none = addPosition({ ticker: 'AAPL', cls: 'Stocks', dir: 'Long', open: '2026-11-05', entry: 200, amount: 2000, qty: 10, reason: '' });
    assert.ok(!('mind' in none), 'not rated is left off');
    const done = addClosedPosition({ ticker: 'NVDA', cls: 'Stocks', dir: 'Long', close: '2026-11-04', pnl: 100, pct: 10, reason: '', mind: 3 });
    assert.equal((done ?? store.state.positions.find((p) => p.ticker === 'NVDA')).mind, 3);
    updatePosition(open.id, { ticker: 'MSFT', cls: 'Stocks', dir: 'Long', open: '2026-11-05', entry: 400, qty: 10, reason: '', mind: 4 });
    assert.equal(store.state.positions.find((p) => p.id === open.id).mind, 4);
    updatePosition(open.id, { ticker: 'MSFT', cls: 'Stocks', dir: 'Long', open: '2026-11-05', entry: 400, qty: 10, reason: '', mind: null });
    assert.ok(!('mind' in store.state.positions.find((p) => p.id === open.id)), 'cleared by choosing Not rated');
    assert.match(read('src/core/store.js'), /if \(Number\.isInteger\(raw\.mind\) && raw\.mind >= 1 && raw\.mind <= 10\) clean\.mind = raw\.mind;/);
    store.clearState();
  });

  test('on the form: ten buttons, optional, labelled from emotional to confident; on the card and in Edit', () => {
    const html = read('index.html');
    assert.equal((html.match(/class="mind-pick" data-mind="\d+"/g) ?? []).length, 10);
    assert.match(html, /1 · Emotional \/ greedy/);
    assert.match(html, /Confident · 10/);
    assert.match(read('src/ui/views/addTrade.js'), /mind: formMind,/);
    const card = read('src/ui/views/positionCard.js');
    assert.match(card, /State of mind at entry <b>\$\{score\}\/10<\/b>/);
    assert.match(card, /id="ed-mind-\$\{p\.id\}"/);
    assert.match(read('src/app/actions.js'), /mind: value\('mind'\) \? Number\(value\('mind'\)\) : null,/);
  });
});

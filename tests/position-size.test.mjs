/**
 * How many shares are held, in two places (October 2026): a Size column on
 * Home, left of the day's move, and "10 shares" in a position's card beside
 * the amount invested.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { fmtShares } from '../src/ui/format.js';
import { positionCard } from '../src/ui/views/positionCard.js';
import { ui } from '../src/ui/uiState.js';

const stock = (extra = {}) => ({
  id: 7, ticker: 'NVDA', cls: 'Stocks', dir: 'Long', status: 'Open',
  entry: 200, cur: 218.88, qty: 10, open: '2026-01-05', ...extra,
});
/** The expanded card's figures, as label → text. */
const figures = (html) => Object.fromEntries([...html.matchAll(/<div class="dgi-k">([^<]+)<\/div>\s*<div class="dgi-v"[^>]*>([\s\S]*?)<\/div>/g)]
  .map((m) => [m[1], m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()]));

describe('the size of a holding', () => {
  test('as people say it: whole shares plain, fractions without trailing zeros', () => {
    assert.equal(fmtShares(10), '10');
    assert.equal(fmtShares(1250), '1,250');
    assert.equal(fmtShares(0.25), '0.25');
    assert.equal(fmtShares(2.5), '2.5');
    assert.equal(fmtShares(-8), '8', 'a short is sized by its shares; the badge says it is short');
  });

  test('in the card, between the amount invested and the value: "10 shares"', () => {
    ui.expandedId = 7;
    const html = positionCard(stock(), true);
    const f = figures(html);
    assert.equal(f.Shares, '10 shares');
    assert.match(html, /Amount invested[\s\S]*Shares[\s\S]*Current value/);
  });

  test('one share, a coin, and a closed position each read right', () => {
    ui.expandedId = 7;
    assert.equal(figures(positionCard(stock({ qty: 1 }), true)).Shares, '1 share');
    assert.equal(figures(positionCard(stock({ ticker: 'BTC', cls: 'Crypto', qty: 0.25, entry: 60000, cur: 65000 }), true)).Shares, '0.25 BTC');
    const closed = figures(positionCard(stock({ status: 'Closed', qty: 10, origQty: 10, close: '2026-03-01' }), true));
    assert.equal(closed['Shares traded'], '10 shares');
  });

  // Since November 2026 the Home columns are the user's own; Quantity is one they can pick.
  test('Quantity is a column anyone can add to Home or Positions, in the same words', async () => {
    const { COLUMNS } = await import('../src/config/columns.js');
    const { columnCell, listContext } = await import('../src/ui/views/holdingColumns.js');
    assert.equal(COLUMNS.qty.label, 'Quantity');
    assert.match(columnCell('qty', stock({ qty: 1250 }), listContext([])), />1,250</);
  });
});

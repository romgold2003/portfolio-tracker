/**
 * The day's move, printed beside the price on a position row.
 *
 * The price was already coloured by the day. The number itself was only in the
 * expanded card, so reading "how did this move today" meant opening every
 * position one at a time.
 *
 * Adding it surfaced something the colour had been hiding. The row read the
 * move straight off the position, while every other daily figure in the app is
 * gated on the session and resets to nothing once the trading day is over. So
 * overnight the price glowed green on yesterday's rise while the card
 * underneath it said the day was flat. Now both agree.
 *
 * The number is the instrument's move; the colour is what that move means for
 * the position. A short whose stock rose shows a rise, in red.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { positionCard } from '../src/ui/views/positionCard.js';
import { state } from '../src/core/store.js';

/** A trading afternoon in New York, well inside the session. */
const MIDDAY = new Date('2026-09-30T17:00:00Z');
/** Half past nine at night in New York: the day is over, the next has not begun. */
const NIGHT = new Date('2026-10-01T01:30:00Z');

function stock(extra = {}) {
  return {
    id: 1, ticker: 'NVDA', cls: 'Stocks', dir: 'Long', status: 'Open',
    entry: 200, cur: 218.88, qty: 10, open: '2026-01-05', ...extra,
  };
}

/** Render one card with the clock held still. */
function render(p, now) {
  const realDate = globalThis.Date;
  class Frozen extends realDate {
    constructor(...args) {
      if (!args.length) return new realDate(now.getTime());
      return new realDate(...args);
    }
    static now() { return now.getTime(); }
  }
  globalThis.Date = Frozen;
  try {
    state.positions = [p];
    return positionCard(p, p.status === 'Open', state.positions);
  } finally {
    globalThis.Date = realDate;
  }
}

describe('while the session is running', () => {
  test('the move is printed next to the price', () => {
    const html = render(stock({ dailyChg: 1.42 }), MIDDAY);
    assert.match(html, /\$218\.88/, 'the price is still there, dollar sign and all');
    assert.match(html, /\+1\.42%/, 'and the day is printed beside it');
  });

  test('a fall is printed as a fall, in red', () => {
    const html = render(stock({ dailyChg: -2.05 }), MIDDAY);
    assert.match(html, /-2\.05%/);
    assert.match(html, /color:var\(--red\)/);
  });

  test('a short shows the stock rising, and reads it as the loss it is', () => {
    // The number belongs to the instrument; the colour belongs to the position.
    const html = render(stock({ dir: 'Short', dailyChg: 1.42 }), MIDDAY);
    assert.match(html, /\+1\.42%/, 'the stock rose, and says so');
    assert.match(html, /color:var\(--red\)/, 'which is a loss on a short');
  });

  test('a short shows the stock falling as a gain', () => {
    const html = render(stock({ dir: 'Short', dailyChg: -1.42 }), MIDDAY);
    assert.match(html, /-1\.42%/);
    assert.match(html, /color:var\(--green\)/);
  });
});

describe('once the trading day is over', () => {
  test('the figure resets rather than carrying yesterday over', () => {
    const html = render(stock({ dailyChg: 1.42 }), NIGHT);
    assert.doesNotMatch(html, /\+1\.42%/, "yesterday's move must not still be showing");
    assert.match(html, /\+0\.00%/, 'the new day starts at nothing');
  });

  test('and the price is no longer coloured by it', () => {
    // A flat day is green throughout this app, so a zeroed figure going green
    // proves nothing. Yesterday's fall is the one that shows: if the price is
    // still red at half past nine at night, it is being coloured by a session
    // that finished.
    const html = render(stock({ dailyChg: -2.05 }), NIGHT);
    const price = html.match(/<span class="pos-liveprice"[^>]*style="color:([^"]+)"/);
    assert.ok(price, 'the price span should still be there');
    assert.equal(price[1], 'var(--green)', 'the price was still red on a day that had ended');
    assert.match(html, /\+0\.00%/, 'and the figure beside it reads flat');
    assert.doesNotMatch(html, /-2\.05%/);
  });

  test('crypto keeps going, because its day never ends', () => {
    const html = render(stock({ cls: 'Crypto', ticker: 'BTC', dailyChg: 3.10 }), NIGHT);
    assert.match(html, /\+3\.10%/, 'crypto has no closed session to reset at');
  });
});

describe('when there is nothing to say', () => {
  test('no daily figure yet means no percentage at all', () => {
    const html = render(stock(), MIDDAY);
    assert.doesNotMatch(html, /%<\/span>\s*<span style="font-size:10px">/, 'nothing should be printed');
    assert.match(html, /\$218\.88/, 'but the price still shows');
  });

  test('a closed position has no day left to report', () => {
    const html = render(stock({ status: 'Closed', dailyChg: 1.42 }), MIDDAY);
    assert.doesNotMatch(html, /\+1\.42%/);
  });

  test('a statement-only trade has no share price to put one beside', () => {
    const html = render(stock({ summary: true, dailyChg: 1.42 }), MIDDAY);
    assert.doesNotMatch(html, /\+1\.42%/);
    assert.match(html, /in<\/span>/, 'it shows the stake instead, as before');
  });
});

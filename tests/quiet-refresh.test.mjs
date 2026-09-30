/**
 * A price refresh that changed nothing must save nothing.
 *
 * `refreshPrices` runs every thirty seconds for as long as the app is open, and
 * it used to call `savePositions()` whichever way the refresh went. A save is
 * encrypted and sent to the cloud vault, so that was a database write every
 * thirty seconds — overnight, at weekends, against prices that had not moved a
 * cent. The database suspends itself after five minutes of quiet and so never
 * once got the chance; it stayed awake all month and the allowance ran out.
 *
 * `refreshOpenPositions` did return whether anything moved, and the caller threw
 * the answer away. But the answer was wrong too, and wrong in a way worth
 * recording: in the pre-market the regular feed quotes yesterday's close, the
 * extended quote then puts the pre-market price back over the top of it, and
 * both steps truthfully report a change. Every refresh therefore claimed the
 * book had moved when it had landed exactly where it started.
 *
 * So the answer is no longer assembled from flags. The book is compared with
 * itself from before the refresh began, which is the question actually being
 * asked and cannot be got wrong by a step that forgets to own up.
 *
 * Everything that would reach the network is stubbed. Nothing here tests a feed.
 */
import { test, beforeEach, afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { refreshOpenPositions } from '../src/services/prices.js';
import { resetExtendedCache } from '../src/services/extendedHours.js';
import { state } from '../src/core/store.js';
import { setCloudEnabled } from '../src/services/cloud.js';

/**
 * A pre-market print. The same payload answers both the regular and the
 * extended quote, which is what the real pair does in the pre-market: `price`
 * is the pre-market print, `regularClose` is yesterday's close, and the two
 * steps write over each other in turn.
 */
function quotePayload(symbol, price) {
  return {
    quotes: [{
      symbol, price, phase: 'pre',
      at: Math.floor(Date.now() / 1000) - 1,
      previousClose: 200,
      regularClose: 202,
    }],
  };
}

/** Run one refresh with the feed answering `price` throughout. */
async function refreshAt(price) {
  globalThis.fetch = async () => ({ ok: true, json: async () => quotePayload('NVDA', price) });
  resetExtendedCache();
  return refreshOpenPositions();
}

let realFetch;

beforeEach(() => {
  realFetch = globalThis.fetch;
  state.positions.length = 0;
  state.apiKey = '';
  setCloudEnabled(true);
  resetExtendedCache();
  state.positions.push({
    id: 1, ticker: 'NVDA', cls: 'Stocks', dir: 'Long', status: 'Open',
    entry: 200, cur: 218.88, qty: 10,
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  state.positions.length = 0;
  setCloudEnabled(false);
});

describe('a book that has not moved', () => {
  test('is not reported as changed, refresh after refresh', async () => {
    /**
     * The first pass is not the case under test: it labels the position as
     * pre-market and fills in the day's baseline, which are real changes and
     * are meant to be saved. What matters is the thirty seconds after that, and
     * the thirty after those — the steady state, where the app sits all night
     * doing nothing and must not be writing to the database.
     */
    assert.equal(await refreshAt(218.88), true, 'the first pass does change things');

    assert.equal(await refreshAt(218.88), false, 'an unchanged book must not ask for a save');
    assert.equal(await refreshAt(218.88), false, 'and must still be quiet on the pass after');
    assert.equal(await refreshAt(218.88), false, 'and the one after that');

    assert.equal(state.positions[0].cur, 218.88, 'the price is left where it was');
  });

  test('is quiet even though the price is written twice on the way through', async () => {
    // The regular feed puts 202 on the position and the extended quote puts
    // 218.88 back. Both are real writes; neither is a change to the book.
    await refreshAt(218.88);
    const settled = JSON.stringify(state.positions[0]);

    assert.equal(await refreshAt(218.88), false);
    assert.equal(JSON.stringify(state.positions[0]), settled,
      'the position must land exactly where it started');
  });
});

describe('a book that has moved', () => {
  test('is reported, so it gets saved', async () => {
    await refreshAt(218.88);
    assert.equal(await refreshAt(219.40), true, 'a real move has to be saved');
    assert.equal(state.positions[0].cur, 219.40);
  });

  test('downwards as well', async () => {
    await refreshAt(218.88);
    assert.equal(await refreshAt(217.10), true);
    assert.equal(state.positions[0].cur, 217.10);
  });

  test('the first time a position is priced at all', async () => {
    state.positions[0] = {
      id: 1, ticker: 'NVDA', cls: 'Stocks', dir: 'Long', status: 'Open',
      entry: 200, qty: 10,
    };
    assert.equal(await refreshAt(218.88), true, 'going from no price to a price is a change');
    assert.equal(state.positions[0].cur, 218.88);
  });

  test('and then goes quiet again once it settles', async () => {
    await refreshAt(218.88);
    assert.equal(await refreshAt(219.40), true);
    assert.equal(await refreshAt(219.40), false, 'one move must not keep saving for ever');
  });
});

describe('the shape of the answer', () => {
  const prices = readFileSync(new URL('../src/services/prices.js', import.meta.url), 'utf8');
  const actions = readFileSync(new URL('../src/app/actions.js', import.meta.url), 'utf8');

  test('is a comparison, not a tally of flags', () => {
    const fn = prices.match(/export async function refreshOpenPositions[\s\S]*?\n\}/)[0];
    assert.match(fn, /const before = JSON\.stringify\(open\);/);
    assert.match(fn, /return JSON\.stringify\(open\) !== before;/);
    assert.doesNotMatch(fn, /changed = true/, 'the flags are what got this wrong');
  });

  test('and the caller only saves on it', () => {
    const fn = actions.match(/export async function refreshPrices[\s\S]*?\n\}/)[0];
    assert.match(fn, /moved = await refreshOpenPositions\(\)/, 'the answer has to be kept');
    assert.match(fn, /if \(moved\) savePositions\(\);/, 'and has to gate the save');
    assert.doesNotMatch(fn, /\n\s*savePositions\(\);/, 'nothing may save unconditionally');
    // The re-render is deliberately not gated: figures left stale on screen were
    // the other half of an earlier bug, and must be repainted every pass.
    assert.match(fn, /\n\s*renderAll\(\);/, 'the re-render must not be gated on a save');
  });
});

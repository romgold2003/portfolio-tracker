/**
 * Prices outside regular trading hours, applied to the book.
 *
 * This file exists because the feature shipped broken and nothing noticed.
 * `refreshOpenPositions` called two functions it had never imported, so every
 * refresh threw a ReferenceError on that line — which also meant the save and
 * re-render that followed never ran. The prices on screen were stale rather
 * than missing, so it looked like the app was working.
 *
 * The first test below is the one that would have caught it: drive the real
 * `refreshOpenPositions` against a stubbed feed and check the position actually
 * moved. Anything that reaches the network is stubbed; nothing here is a test
 * of Yahoo.
 */
import { test, beforeEach, afterEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { applyExtendedQuotes, resetExtendedCache } from '../src/services/extendedHours.js';
import { refreshOpenPositions } from '../src/services/prices.js';
import { state } from '../src/core/store.js';
import { setCloudEnabled } from '../src/services/cloud.js';

/** A pre-market print, one second old. */
function quotePayload(symbol, price, phase = 'pre') {
  return {
    quotes: [{
      symbol, price, phase,
      at: Math.floor(Date.now() / 1000) - 1,
      previousClose: 200,
      regularClose: 202,
    }],
  };
}

let realFetch;
let asked;

beforeEach(() => {
  asked = [];
  realFetch = globalThis.fetch;
  state.positions.length = 0;
  state.apiKey = '';
  setCloudEnabled(true);
  resetExtendedCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  state.positions.length = 0;
  setCloudEnabled(false);
});

describe('a refresh with the market shut', () => {
  test('moves an open stock to its pre-market price', async () => {
    state.positions.push({
      id: 1, ticker: 'NVDA', cls: 'Stocks', dir: 'Long', status: 'Open',
      entry: 200, cur: 200, qty: 10,
    });

    globalThis.fetch = async (url) => {
      asked.push(String(url));
      return { ok: true, json: async () => quotePayload('NVDA', 218.88) };
    };

    // The bug was a ReferenceError thrown from inside here. Reaching the
    // assertions at all is half of what this test checks.
    const changed = await refreshOpenPositions();

    assert.ok(asked.some((u) => u.includes('/api/quote')), 'it should ask for extended quotes');
    assert.equal(changed, true);
    assert.equal(state.positions[0].cur, 218.88, 'the pre-market price should be showing');
    assert.equal(state.positions[0].extPhase, 'pre', 'and be labelled as pre-market');
  });

  test('a failing quote feed leaves the regular price alone', async () => {
    state.positions.push({
      id: 1, ticker: 'NVDA', cls: 'Stocks', dir: 'Long', status: 'Open',
      entry: 200, cur: 211, qty: 10,
    });

    globalThis.fetch = async () => { throw new Error('network is down'); };

    await assert.doesNotReject(() => refreshOpenPositions());
    assert.equal(state.positions[0].cur, 211, 'the last known price should survive');
    assert.equal(state.positions[0].extPhase, undefined);
  });

  test('crypto is never asked about — it has no closed session', async () => {
    state.positions.push({
      id: 1, ticker: 'BTC', cls: 'Crypto', dir: 'Long', status: 'Open',
      entry: 60000, cur: 61000, qty: 0.5,
    });

    globalThis.fetch = async (url) => {
      asked.push(String(url));
      return { ok: true, json: async () => ({}) };
    };

    await refreshOpenPositions();
    assert.ok(!asked.some((u) => u.includes('/api/quote')), 'crypto needs no extended quote');
  });
});

describe('applying an extended quote', () => {
  test('the daily move is recomputed against the previous close', () => {
    const positions = [{ ticker: 'NVDA', status: 'Open', cur: 200, dailyChg: 1 }];
    applyExtendedQuotes(positions, new Map([
      ['NVDA', { price: 210, phase: 'pre', previousClose: 200, regularClose: 202 }],
    ]));

    assert.equal(positions[0].cur, 210);
    // Not left at 1: the day's move is reconstructed elsewhere as
    // cur / (1 + dailyChg/100), and a stale percentage makes that produce a
    // previous close that never existed.
    assert.equal(positions[0].dailyChg.toFixed(2), '5.00');
  });

  test('a closed position is left where it is', () => {
    const positions = [{ ticker: 'NVDA', status: 'Closed', cur: 180 }];
    applyExtendedQuotes(positions, new Map([
      ['NVDA', { price: 210, phase: 'pre', previousClose: 200 }],
    ]));
    assert.equal(positions[0].cur, 180);
  });

  test('the badge is cleared once the session reopens', () => {
    const positions = [{ ticker: 'NVDA', status: 'Open', cur: 210, extPhase: 'pre' }];
    const changed = applyExtendedQuotes(positions, new Map());
    assert.equal(changed, true);
    assert.equal(positions[0].extPhase, undefined, 'a stale PRE badge would be a lie');
  });

  test('lower-case tickers still match', () => {
    const positions = [{ ticker: 'nvda', status: 'Open', cur: 200 }];
    applyExtendedQuotes(positions, new Map([
      ['NVDA', { price: 210, phase: 'post', previousClose: 200 }],
    ]));
    assert.equal(positions[0].cur, 210);
    assert.equal(positions[0].extPhase, 'post');
  });
});

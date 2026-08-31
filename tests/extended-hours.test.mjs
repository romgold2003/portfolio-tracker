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

import {
  applyExtendedQuotes, resetExtendedCache, regularSessionOpen, tradingDayOver,
} from '../src/services/extendedHours.js';
import { refreshOpenPositions } from '../src/services/prices.js';
import { state } from '../src/core/store.js';
import { dailyDollar } from '../src/core/portfolio.js';
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

    await refreshOpenPositions(new Date('2026-09-01T01:00:00Z'));
    assert.ok(!asked.some((u) => u.includes('/api/quote')), 'crypto needs no extended quote');
  });
});

describe('knowing whether the market is open', () => {
  // Written as UTC instants, with the New York wall-clock they land on noted,
  // because that is the thing being asserted.
  const cases = [
    ['2026-08-31T13:29:00Z', false, 'Monday 09:29 ET — one minute before the bell'],
    ['2026-08-31T13:30:00Z', true, 'Monday 09:30 ET — the open'],
    ['2026-08-31T19:59:00Z', true, 'Monday 15:59 ET — one minute before the close'],
    ['2026-08-31T20:00:00Z', false, 'Monday 16:00 ET — the close'],
    ['2026-08-31T10:00:00Z', false, 'Monday 06:00 ET — pre-market is not the session'],
    ['2026-08-31T22:00:00Z', false, 'Monday 18:00 ET — after hours is not the session'],
    ['2026-08-29T17:00:00Z', false, 'Saturday 13:00 ET'],
    ['2026-08-30T17:00:00Z', false, 'Sunday 13:00 ET'],
    // January is EST, so the same UTC instant is an hour earlier in New York.
    ['2026-01-05T14:30:00Z', true, 'Monday 09:30 EST — the offset changes, the rule does not'],
    ['2026-01-05T21:30:00Z', false, 'Monday 16:30 EST'],
  ];

  for (const [iso, open, why] of cases) {
    test(why, () => {
      assert.equal(regularSessionOpen(new Date(iso)), open);
    });
  }
});

describe('when the trading day rolls over', () => {
  // 20:00 New York is 03:00 in Israel, which is the boundary this was asked for.
  const cases = [
    ['2026-08-31T07:59:00Z', true, 'Monday 03:59 ET — before pre-market opens'],
    ['2026-08-31T08:00:00Z', false, 'Monday 04:00 ET — pre-market opens, the day begins'],
    ['2026-08-31T19:00:00Z', false, 'Monday 15:00 ET — mid-session'],
    ['2026-08-31T23:59:00Z', false, 'Monday 19:59 ET — one minute of after-hours left'],
    ['2026-09-01T00:00:00Z', true, 'Monday 20:00 ET — after-hours ends, 03:00 in Israel'],
    ['2026-09-01T03:00:00Z', true, 'Monday 23:00 ET — nothing trades'],
    ['2026-08-29T17:00:00Z', true, 'Saturday — the whole weekend is over'],
  ];

  for (const [iso, over, why] of cases) {
    test(why, () => {
      assert.equal(tradingDayOver(new Date(iso)), over);
    });
  }

  test('an empty feed after 20:00 holds the figures instead of clearing them', () => {
    const positions = [{ ticker: 'NVDA', status: 'Open', cur: 224, dailyChg: 2.96, extPhase: 'post' }];
    const changed = applyExtendedQuotes(positions, new Map(), new Date('2026-09-01T01:00:00Z'));

    assert.equal(changed, false);
    assert.equal(positions[0].cur, 224, 'the evening close should stand');
    assert.equal(positions[0].extPhase, 'post', 'and still be labelled as after-hours');
    assert.equal(positions[0].dailyChg, 2.96, 'the day should not shrink back overnight');
  });

  test('an empty feed during the session does clear them', () => {
    const positions = [{ ticker: 'NVDA', status: 'Open', cur: 224, dailyChg: 2.96, extPhase: 'pre' }];
    const changed = applyExtendedQuotes(positions, new Map(), new Date('2026-08-31T15:00:00Z'));

    assert.equal(changed, true);
    assert.equal(positions[0].extPhase, undefined, 'the market reopened; the badge is a lie now');
  });

  test('the overnight hold does not re-quote a stock that already closed', async () => {
    state.positions.push({
      id: 1, ticker: 'NVDA', cls: 'Stocks', dir: 'Long', status: 'Open',
      entry: 200, cur: 224, qty: 10, extPhase: 'post',
    });
    state.apiKey = 'a-finnhub-key';

    globalThis.fetch = async (url) => {
      asked.push(String(url));
      return { ok: true, json: async () => ({ quotes: [] }) };
    };

    await refreshOpenPositions(new Date('2026-09-01T01:00:00Z'));

    // Only the extended endpoint should have been asked. Finnhub would have
    // answered with the 16:00 close and undone the evening.
    assert.ok(!asked.some((u) => u.includes('finnhub')), 'the regular feed must not overwrite it');
  });
});

describe('which close the day is measured from', () => {
  /**
   * The real numbers this got wrong. NVDA on the morning of Monday 31 August:
   * Friday closed at 217.55, Thursday at 227.98, and it was trading at 218.70
   * before the open. The move that morning is +0.53%, not −4.07%.
   */
  test('pre-market measures from the last regular close, not the one before it', () => {
    const positions = [{ ticker: 'NVDA', status: 'Open', cur: 217.55, dailyChg: 0 }];
    applyExtendedQuotes(positions, new Map([
      ['NVDA', { price: 218.70, phase: 'pre', regularClose: 217.55, previousClose: 227.98 }],
    ]));

    assert.equal(positions[0].cur, 218.70);
    assert.equal(positions[0].dailyChg.toFixed(2), '0.53');
  });

  /**
   * After the close the fields have shuffled along: regularClose is today, and
   * yesterday — the thing today is measured against — is previousClose.
   */
  test('after hours measures from the session before today', () => {
    const positions = [{ ticker: 'NVDA', status: 'Open', cur: 220, dailyChg: 0 }];
    applyExtendedQuotes(positions, new Map([
      ['NVDA', { price: 224, phase: 'post', regularClose: 220, previousClose: 217.55 }],
    ]));

    assert.equal(positions[0].dailyChg.toFixed(2), '2.96');
  });

  test('a missing close falls back to the other one rather than giving up', () => {
    const positions = [{ ticker: 'NVDA', status: 'Open', cur: 200, dailyChg: 0 }];
    applyExtendedQuotes(positions, new Map([
      ['NVDA', { price: 210, phase: 'pre', regularClose: null, previousClose: 200 }],
    ]));
    assert.equal(positions[0].dailyChg.toFixed(2), '5.00');
  });

  test('the day change drives the dollar figure under it', () => {
    const positions = [{
      ticker: 'NVDA', status: 'Open', dir: 'Long', qty: 10,
      cur: 217.55, entry: 200, open: '2026-08-01', dailyChg: 0,
    }];
    applyExtendedQuotes(positions, new Map([
      ['NVDA', { price: 218.70, phase: 'pre', regularClose: 217.55, previousClose: 227.98 }],
    ]));

    // Ten shares that rose 1.15 overnight are up 11.50 today — and the wrong
    // baseline would have reported a loss of about 93.
    assert.equal(dailyDollar(positions[0]).toFixed(2), '11.50');
  });
});

describe('the regular session, where the two feeds disagreed', () => {
  /**
   * The portfolio's day was coming out five times worse than the broker's while
   * every individual price was right. The cause was two feeds measuring from
   * two different closes: whatever the regular feed had no answer for kept the
   * day change it was last given, so the total was part today and part
   * yesterday. The baseline now comes from one place for every holding.
   */
  test('a regular-session quote sets the day from the previous close', () => {
    const positions = [{ ticker: 'META', status: 'Open', dir: 'Long', cur: 572.17, dailyChg: -9.9 }];
    applyExtendedQuotes(positions, new Map([
      // During the session the feed reports the live price as regularClose.
      ['META', { price: 572.17, phase: 'regular', regularClose: 572.17, previousClose: 578.02 }],
    ]), new Date('2026-08-31T13:40:00Z'));

    assert.equal(positions[0].dailyChg.toFixed(2), '-1.01', 'the stale figure must be replaced');
    assert.equal(positions[0].extPhase, undefined, 'the session is open; there is no badge');
  });

  test('a regular-session quote does not overwrite the live price', () => {
    // The one-minute bar can lag the live feed, and the account value is
    // correct as it stands — only the baseline was ever wrong.
    const positions = [{ ticker: 'AMD', status: 'Open', dir: 'Long', cur: 470.23, dailyChg: 0 }];
    applyExtendedQuotes(positions, new Map([
      ['AMD', { price: 469.80, phase: 'regular', regularClose: 470.23, previousClose: 465.58 }],
    ]), new Date('2026-08-31T13:40:00Z'));

    assert.equal(positions[0].cur, 470.23, 'the live price stands');
    assert.equal(positions[0].dailyChg.toFixed(2), '1.00');
  });

  test('a short is measured the same way, whichever direction it went', () => {
    const positions = [{ ticker: 'META', status: 'Open', dir: 'Short', cur: 572.17, dailyChg: 0 }];
    applyExtendedQuotes(positions, new Map([
      ['META', { price: 572.17, phase: 'regular', regularClose: 572.17, previousClose: 578.02 }],
    ]), new Date('2026-08-31T13:40:00Z'));

    // The stored figure is the asset's move; the display signs it per position.
    assert.equal(positions[0].dailyChg.toFixed(2), '-1.01');
  });
});

describe('applying an extended quote', () => {
  test('the daily move is recomputed rather than left stale', () => {
    const positions = [{ ticker: 'NVDA', status: 'Open', cur: 200, dailyChg: 1 }];
    applyExtendedQuotes(positions, new Map([
      ['NVDA', { price: 210, phase: 'post', previousClose: 200, regularClose: 202 }],
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

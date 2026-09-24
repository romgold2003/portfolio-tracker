/**
 * The day's figures start again from nothing at three in the morning.
 *
 * The American session ends at eight in the evening in New York, which is three
 * in the morning in Israel. From that moment what is on screen is a day that
 * has not traded, so every daily figure reads zero until the market opens
 * again — rather than carrying yesterday's result forward under a heading that
 * says today.
 *
 * Reported in those words: at three it should reset, and at ten in the morning
 * it was still showing yesterday's daily return.
 *
 * Crypto is not an exception so much as a different market: it never stops, so
 * there is no moment at which its day is over, and a book holding it keeps
 * showing real movement overnight and through the weekend.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { dayStillRunning, inPlay } from '../src/ui/dayReset.js';

const RealDate = Date;
afterEach(() => { globalThis.Date = RealDate; });
function at(iso) {
  globalThis.Date = class extends RealDate {
    constructor(...args) { return args.length ? new RealDate(...args) : new RealDate(iso); }
    static now() { return new RealDate(iso).getTime(); }
  };
}

const stock = { status: 'Open', cls: 'Stocks', ticker: 'A', dir: 'Long', qty: 1, entry: 1, cur: 1, dailyChg: 2.41 };
const coin = { status: 'Open', cls: 'Crypto', ticker: 'BTC', dir: 'Long', qty: 1, entry: 1, cur: 1, dailyChg: 5 };

/** Each moment as its Israeli wall clock, which is how it was described. */
const MOMENTS = [
  ['2026-09-23T13:35:00Z', 'IL 16:35 — the opening bell', true],
  ['2026-09-23T19:59:00Z', 'IL 22:59 — a minute before the close', true],
  ['2026-09-23T20:30:00Z', 'IL 23:30 — after hours, still trading', true],
  ['2026-09-23T23:59:00Z', 'IL 02:59 — one minute to go', true],
  ['2026-09-24T00:00:00Z', 'IL 03:00 — the reset', false],
  ['2026-09-24T02:00:00Z', 'IL 05:00', false],
  ['2026-09-24T07:00:00Z', 'IL 10:00 — the hour it was reported at', false],
  ['2026-09-24T07:59:00Z', 'IL 10:59 — the last minute of it', false],
  ['2026-09-24T08:00:00Z', 'IL 11:00 — pre-market, the day begins', true],
];

describe('a stock holding', () => {
  for (const [iso, when, running] of MOMENTS) {
    test(`${when}: ${running ? 'counting' : 'reset to nothing'}`, () => {
      at(iso);
      assert.equal(dayStillRunning(stock), running);
    });
  }

  test('stays reset all weekend, since nothing trades', () => {
    at('2026-09-26T04:00:00Z'); // Saturday
    assert.equal(dayStillRunning(stock), false);
    at('2026-09-27T14:00:00Z'); // Sunday
    assert.equal(dayStillRunning(stock), false);
  });
});

describe('a crypto holding', () => {
  test('never resets, because its market never closes', () => {
    for (const [iso, when] of MOMENTS) {
      at(iso);
      assert.equal(dayStillRunning(coin), true, when);
    }
    at('2026-09-27T14:00:00Z'); // Sunday
    assert.equal(dayStillRunning(coin), true, 'the weekend too');
  });
});

describe('what the portfolio figure is built from', () => {
  test('everything, while the session is running', () => {
    at('2026-09-23T16:00:00Z');
    assert.deepEqual(inPlay([stock, coin]), [stock, coin]);
  });

  test('only the crypto, once the day is over', () => {
    at('2026-09-24T07:00:00Z');
    assert.deepEqual(inPlay([stock, coin]), [coin]);
  });

  test('nothing at all in a book of stocks, which is the reset to zero', () => {
    at('2026-09-24T07:00:00Z');
    assert.deepEqual(inPlay([stock, { ...stock, ticker: 'B' }]), []);
  });

  test('an empty book is not an error', () => {
    at('2026-09-24T07:00:00Z');
    assert.deepEqual(inPlay([]), []);
    assert.deepEqual(inPlay(undefined), []);
  });
});

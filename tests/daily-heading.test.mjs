/**
 * The word above the day's figure.
 *
 * The American session ends at eight in the evening in New York — three in the
 * morning in Israel — and nothing trades again until pre-market at four, which
 * is eleven in the morning there. Through those eight hours the figures are
 * deliberately held where the day left them, because nothing has happened to
 * move them. That part was right.
 *
 * The heading was not. At ten in the morning the box said "Today" over
 * Wednesday's move, and nothing on the screen said otherwise — so a finished
 * day was indistinguishable from a quiet one. Reported in those words: "at 3am
 * the price should reset for the new day, and now it's already 10am and it
 * still shows the daily return of yesterday."
 */
import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../src/core/store.js';
import { dailyHeading } from '../src/ui/views/home.js';

const RealDate = Date;
function at(iso) {
  globalThis.Date = class extends RealDate {
    constructor(...args) { return args.length ? new RealDate(...args) : new RealDate(iso); }
    static now() { return new RealDate(iso).getTime(); }
  };
}

const stock = { status: 'Open', cls: 'Stocks', ticker: 'A', dir: 'Long', qty: 1, entry: 1, cur: 1 };
const coin = { status: 'Open', cls: 'Crypto', ticker: 'BTC', dir: 'Long', qty: 1, entry: 1, cur: 1 };

beforeEach(() => { state.positions = [stock]; });
afterEach(() => { globalThis.Date = RealDate; });

describe('a book holding stocks', () => {
  test('says Today while the session is running', () => {
    at('2026-09-23T16:00:00Z'); // New York midday, Wednesday
    assert.equal(dailyHeading(), 'Today');
  });

  test('and from pre-market onwards, because that is the new day', () => {
    at('2026-09-24T08:30:00Z'); // New York 04:30 Thursday — 11:30 in Israel
    assert.equal(dailyHeading(), 'Today');
  });

  test('names the session once after-hours has ended', () => {
    at('2026-09-24T00:30:00Z'); // New York 20:30 Wednesday — 03:30 in Israel
    assert.equal(dailyHeading(), 'Last session · Wed 23 Sep');
  });

  test('and still names it at ten the next morning in Israel', () => {
    at('2026-09-24T07:00:00Z'); // New York 03:00 Thursday — 10:00 in Israel
    assert.equal(dailyHeading(), 'Last session · Wed 23 Sep', 'this is the hour it was reported at');
  });

  test('over a weekend it names the Friday', () => {
    at('2026-09-27T14:00:00Z'); // Sunday
    assert.equal(dailyHeading(), 'Last session · Fri 25 Sep');
  });
});

describe('a book holding only crypto', () => {
  test('always says Today, because crypto never stops', () => {
    state.positions = [coin];
    at('2026-09-24T07:00:00Z');
    assert.equal(dailyHeading(), 'Today');
    at('2026-09-27T14:00:00Z'); // the weekend, when nothing else trades
    assert.equal(dailyHeading(), 'Today');
  });

  test('but one stock alongside it is enough to name the session', () => {
    state.positions = [coin, stock];
    at('2026-09-24T07:00:00Z');
    assert.equal(dailyHeading(), 'Last session · Wed 23 Sep');
  });

  test('and a closed stock position does not count — it holds nothing', () => {
    state.positions = [coin, { ...stock, status: 'Closed' }];
    at('2026-09-24T07:00:00Z');
    assert.equal(dailyHeading(), 'Today');
  });
});

/**
 * Exchange netflow, and the verdict that weighs it against everything else.
 *
 * Two things here are easy to get exactly backwards, and both would be worse
 * than having no signal at all:
 *
 *   - **Netflow inverts.** Coins arriving on an exchange is bearish, so the
 *     bullish reading is the negative number.
 *   - **Stablecoins invert again.** Money arriving on an exchange is money
 *     about to buy, so for them the positive number is the bullish one.
 *
 * Getting either wrong turns the most actionable metric in the tracker into a
 * precisely wrong one, which is why they are pinned here rather than trusted.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { netflow, exchangeOf, VENUES } from '../api/_lib/exchanges.js';
import { verdictFor, isStable } from '../api/_lib/verdict.js';

const NOW = 1_790_000_000_000;
const AT = Math.floor(NOW / 1000) - 3600;

const LABELS = new Map([
  ['0xbin', { venue: 'Binance', name: 'Binance 14' }],
  ['0xcb', { venue: 'Coinbase', name: 'Coinbase 1' }],
]);

const move = (from, to, usd, symbol = 'ETH') => ({
  at: AT, kind: 'transfer', symbol, usd,
  from: { address: from }, to: { address: to },
});

describe('the exchange label set', () => {
  test('an address is matched whatever its case', () => {
    assert.equal(exchangeOf('0xBIN', LABELS)?.venue, 'Binance');
    assert.equal(exchangeOf('0xbin', LABELS)?.venue, 'Binance');
  });

  test('an unlabelled address is null, never a guess', () => {
    assert.equal(exchangeOf('0xsomebody', LABELS), null);
    assert.equal(exchangeOf(null, LABELS), null);
    assert.equal(exchangeOf('0xbin', null), null);
  });

  test('the venues worth naming are the ones large flow reaches', () => {
    for (const v of ['binance', 'coinbase', 'kraken', 'okx', 'bybit', 'bitfinex']) {
      assert.ok(VENUES[v], `${v} is not named`);
    }
  });
});

describe('netflow, which inverts', () => {
  test('coins leaving an exchange is a negative net and reads as accumulation', () => {
    const [f] = netflow([move('0xbin', '0xwhale', 9_000_000)], { byAddress: LABELS, now: NOW });
    assert.equal(f.netUsd, -9_000_000);
    assert.equal(f.outUsd, 9_000_000);
    assert.equal(f.reading, 'accumulation');
    assert.equal(f.netPct, -100);
  });

  test('coins arriving is positive and reads as distribution', () => {
    const [f] = netflow([move('0xwhale', '0xbin', 9_000_000)], { byAddress: LABELS, now: NOW });
    assert.equal(f.netUsd, 9_000_000);
    assert.equal(f.inUsd, 9_000_000);
    assert.equal(f.reading, 'distribution');
  });

  test('exchange to exchange is housekeeping and is not flow', () => {
    // Venues move their own float between hot and cold wallets constantly.
    // Counting it would make the busiest housekeeping the strongest signal.
    assert.deepEqual(netflow([move('0xbin', '0xcb', 500_000_000)],
      { byAddress: LABELS, now: NOW }), []);
  });

  test('a transfer touching no exchange is not flow either', () => {
    assert.deepEqual(netflow([move('0xa', '0xb', 9_000_000)],
      { byAddress: LABELS, now: NOW }), []);
  });

  test('in and out net against each other, and the venue is named', () => {
    const [f] = netflow([
      move('0xbin', '0xwhale', 10_000_000),
      move('0xwhale2', '0xbin', 4_000_000),
    ], { byAddress: LABELS, now: NOW });
    assert.equal(f.inUsd, 4_000_000);
    assert.equal(f.outUsd, 10_000_000);
    assert.equal(f.netUsd, -6_000_000);
    assert.equal(f.grossUsd, 14_000_000);
    assert.deepEqual(f.venues, [{ venue: 'Binance', netUsd: -6_000_000 }]);
  });

  test('a window only counts what falls inside it', () => {
    const old = { ...move('0xbin', '0xw', 9_000_000), at: AT - 40 * 86400 };
    assert.deepEqual(netflow([old], { byAddress: LABELS, hours: 24, now: NOW }), []);
    assert.equal(netflow([old], { byAddress: LABELS, hours: Infinity, now: NOW }).length, 1);
  });
});

describe('the verdict', () => {
  const flow = (n) => ({ netUsd: n, transfers: 5 });

  test('stablecoins read the opposite way round', () => {
    // Money arriving on an exchange is money about to buy. Treating it like a
    // coin would count buying power as selling pressure.
    assert.ok(isStable('USDT') && isStable('USDC') && !isStable('ETH'));
    const v = verdictFor({ stables: { netUsd: 9_000_000 } });
    assert.equal(v.signals.find((s) => s.id === 'stables').reads, 'bullish');
  });

  test('everything pointing one way is a strong call', () => {
    const v = verdictFor({
      flow: flow(-9_000_000),
      stables: { netUsd: 9_000_000 },
      wallets: [{ netUsd: 9_000_000 }],
      holders: [{ usdDelta: 9_000_000, insider: false }],
    });
    assert.equal(v.trend, 'Strong accumulation');
    assert.equal(v.bullish, 4);
    assert.equal(v.heard, 4);
  });

  test('two signals agreeing is not "strong", however unanimous', () => {
    // Two out of two is a share of 1.0 and looked like the strongest possible
    // reading, which is backwards: it is the thinnest evidence that can produce
    // a call at all. Convergence is the whole idea.
    const v = verdictFor({ flow: flow(-9_000_000), wallets: [{ netUsd: 9_000_000 }] });
    assert.equal(v.heard, 2);
    assert.equal(v.trend, 'Accumulation');
  });

  test('a signal with no data abstains rather than voting neutral', () => {
    const v = verdictFor({ flow: flow(-9_000_000) });
    assert.equal(v.heard, 1);
    assert.equal(v.trend, 'Neutral', 'one signal is that signal with a grander name');
    assert.equal(v.thin, true);
    assert.equal(v.signals.filter((s) => s.reads === 'no data').length, 3);
  });

  test('a split verdict is neutral, however much money moved', () => {
    const v = verdictFor({
      flow: flow(400_000_000),
      stables: { netUsd: -400_000_000 },
      wallets: [{ netUsd: 400_000_000 }],
      holders: [{ usdDelta: 400_000_000, insider: false }],
    });
    assert.equal(v.trend, 'Neutral');
    assert.equal(v.bullish, 2);
    assert.equal(v.bearish, 2);
  });

  test('a number too small to mean anything is not a vote', () => {
    const v = verdictFor({ flow: flow(-1000), wallets: [{ netUsd: 900 }] });
    assert.equal(v.heard, 0);
    assert.equal(v.trend, 'Neutral');
  });

  test('insider selling is flagged separately from the trend', () => {
    // The verdict can be accumulation while the people who made the thing are
    // getting out, and that is worth saying on its own.
    const v = verdictFor({
      flow: flow(-9_000_000),
      wallets: [{ netUsd: 20_000_000 }],
      holders: [{ usdDelta: -3_000_000, insider: true }],
    });
    assert.equal(v.insiderSelling, true);
  });

  test('every signal is reported whether or not it voted', () => {
    // A verdict nobody can take apart is a verdict nobody should trust.
    const v = verdictFor({});
    assert.equal(v.signals.length, 4);
    assert.deepEqual(v.signals.map((s) => s.id), ['exchange', 'stables', 'holders', 'whales']);
    assert.equal(v.of, 4);
  });
});

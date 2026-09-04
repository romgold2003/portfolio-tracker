/**
 * Large bets on macro events.
 *
 * Polymarket's volume is overwhelmingly sport and five-minute price markets —
 * of five hundred trades above $100,000 in one sample, twenty were macro. So
 * the filter is the feature: get it wrong in the permissive direction and the
 * panel is a tennis ticker, get it wrong the other way and the trade worth
 * seeing never appears.
 *
 * The fixtures are shaped exactly like the live rows, including the ones that
 * caught real problems: a bare "war" that would take "Warriors", a "sec" that
 * would take "second".
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  BANDS, bandDef, topicOf, cashOf, selectTrades, FLOOR_USD, TOPIC_TABS, countByTopic,
} from '../src/services/gamble.js';

/** A row in the feed's own shape. `size` is shares, `price` is 0–1. */
const trade = (over = {}) => ({
  proxyWallet: '0x3a8ad0f1b2c3d4e5f60718293a4b5c6d7e8f7699',
  pseudonym: 'Fabulous-Online',
  name: '1791099329',
  side: 'BUY',
  outcome: 'No',
  title: 'Will the Fed decrease interest rates by 25 bps in September?',
  size: 1_000_000,
  price: 0.15,
  timestamp: 1788525804,
  ...over,
});

describe('what counts as macro', () => {
  test('the three subjects that were actually asked for', () => {
    assert.equal(topicOf('Will the Fed decrease interest rates by 25 bps?').id, 'fed');
    assert.equal(topicOf('Will the U.S. invade Iran before 2027?').id, 'geo');
    assert.equal(topicOf('Clarity Act (H.R.3633) signed into law in 2026?').id, 'policy');
  });

  test('sport and five-minute price markets are not macro', () => {
    for (const title of [
      'LoL: KT Rolster vs Dplus KIA - Game 1 Winner',
      'US Open ATP: Yibing Wu vs Carlos Alcaraz',
      'Atlanta Braves vs. Washington Nationals',
      'Bitcoin Up or Down - September 4, 8:40AM-8:45AM ET',
      'Will Taylor Swift release an album in 2026?',
    ]) {
      assert.equal(topicOf(title), null, `"${title}" leaked into the panel`);
    }
  });

  test('a word inside another word is not a match', () => {
    // The two that would actually bite: "Warriors" holds "war", and any market
    // with "second" in it holds "sec".
    assert.equal(topicOf('NBA: Golden State Warriors vs Phoenix Suns'), null);
    assert.equal(topicOf('Will the second game go to overtime?'), null);
  });

  test('economy and politics are carried too', () => {
    assert.equal(topicOf('Will there be a government shutdown in 2026?').id, 'econ');
    assert.equal(topicOf('US recession in 2026?').id, 'econ');
    assert.equal(topicOf('Who will win the 2028 presidential election?').id, 'polit');
  });

  test('an absent or odd title is not a crash', () => {
    assert.equal(topicOf(null), null);
    assert.equal(topicOf(''), null);
    assert.equal(topicOf(12345), null);
  });
});

describe('what a trade is worth', () => {
  test('shares times price, which is the cash that changed hands', () => {
    // A million shares at fifteen cents is $150,000 of conviction.
    assert.equal(cashOf(trade()), 150_000);
    assert.equal(cashOf({ size: 500_000, price: 0.9 }), 450_000);
  });

  test('a malformed row is worth nothing rather than NaN', () => {
    assert.equal(cashOf({}), 0);
    assert.equal(cashOf(null), 0);
    assert.equal(cashOf({ size: 'lots', price: 0.5 }), 0);
  });
});

describe('the size bands', () => {
  const rows = [
    trade({ size: 1_000_000, price: 0.12, timestamp: 5 }),   // 120k
    trade({ size: 1_000_000, price: 0.30, timestamp: 4 }),   // 300k
    trade({ size: 1_000_000, price: 0.75, timestamp: 3 }),   // 750k
  ];

  test('each band takes only its own', () => {
    assert.deepEqual(selectTrades(rows, { band: 'small' }).map((t) => t.usd), [120_000]);
    assert.deepEqual(selectTrades(rows, { band: 'mid' }).map((t) => t.usd), [300_000]);
    assert.deepEqual(selectTrades(rows, { band: 'large' }).map((t) => t.usd), [750_000]);
  });

  test('the boundaries fall one way only, so nothing is counted twice', () => {
    // Exactly $250,000 belongs to the middle band, not to both.
    const edge = [trade({ size: 1_000_000, price: 0.25 })];
    assert.equal(selectTrades(edge, { band: 'small' }).length, 0);
    assert.equal(selectTrades(edge, { band: 'mid' }).length, 1);
  });

  test('the bands start where the feed is asked to start', () => {
    assert.equal(BANDS[0].min, FLOOR_USD);
    assert.equal(BANDS[BANDS.length - 1].max, Infinity, 'the top band must not close');
  });

  test('an unknown band falls back rather than showing nothing', () => {
    assert.equal(bandDef('nonsense').id, BANDS[0].id);
  });
});

describe('the rows it hands the panel', () => {
  test('the wallet is kept whole and also shortened for display', () => {
    const [t] = selectTrades([trade()], { band: 'small' });
    assert.equal(t.wallet, '0x3a8ad0f1b2c3d4e5f60718293a4b5c6d7e8f7699');
    assert.equal(t.shortWallet, '0x3a8a…7699');
  });

  test('the pseudonym is the name, and the wallet stands in when there is none', () => {
    const [named] = selectTrades([trade()], { band: 'small' });
    assert.equal(named.trader, 'Fabulous-Online');

    const [anon] = selectTrades([trade({ pseudonym: '', name: '' })], { band: 'small' });
    assert.equal(anon.trader, '0x3a8a…7699', 'a nameless whale is still identifiable');
  });

  test('a row with no wallet is dropped, not shown blank', () => {
    // The panel exists to say who placed the bet. A row that cannot is not a
    // smaller answer, it is a different one.
    assert.equal(selectTrades([trade({ proxyWallet: '' })], { band: 'small' }).length, 0);
    assert.equal(selectTrades([trade({ title: '' })], { band: 'small' }).length, 0);
  });

  test('newest first', () => {
    const rows = [
      trade({ timestamp: 100, size: 1_000_000, price: 0.11 }),
      trade({ timestamp: 300, size: 1_000_000, price: 0.12 }),
      trade({ timestamp: 200, size: 1_000_000, price: 0.13 }),
    ];
    assert.deepEqual(selectTrades(rows, { band: 'small' }).map((t) => t.at), [300, 200, 100]);
  });

  test('a sell is carried as a sell', () => {
    const [t] = selectTrades([trade({ side: 'SELL', outcome: 'Yes' })], { band: 'small' });
    assert.equal(t.side, 'SELL');
    assert.equal(t.outcome, 'Yes');
  });

  test('an unknown side is not trusted into the output', () => {
    const [t] = selectTrades([trade({ side: '<script>' })], { band: 'small' });
    assert.equal(t.side, 'BUY', 'anything not SELL is BUY, never the raw field');
  });

  test('nothing to show is an empty list, not a throw', () => {
    assert.deepEqual(selectTrades(null, { band: 'small' }), []);
    assert.deepEqual(selectTrades([], { band: 'small' }), []);
  });
});

describe('filtering to one subject', () => {
  const rows = [
    trade({ title: 'Will the Fed decrease interest rates by 25 bps?', size: 1e6, price: 0.12 }),
    trade({ title: 'Will the U.S. invade Iran before 2027?', size: 1e6, price: 0.13 }),
    trade({ title: 'Clarity Act (H.R.3633) signed into law in 2026?', size: 1e6, price: 0.14 }),
    trade({ title: 'LoL: KT Rolster vs Dplus KIA', size: 1e6, price: 0.15 }),
  ];

  test('a subject takes only its own, and "all" takes every macro one', () => {
    assert.equal(selectTrades(rows, { band: 'small', topic: 'fed' }).length, 1);
    assert.equal(selectTrades(rows, { band: 'small', topic: 'geo' }).length, 1);
    assert.equal(selectTrades(rows, { band: 'small', topic: 'all' }).length, 3);
  });

  test('the sport stays out whichever subject is asked for', () => {
    for (const t of TOPIC_TABS) {
      const titles = selectTrades(rows, { band: 'small', topic: t.id }).map((r) => r.title);
      assert.ok(!titles.some((x) => x.startsWith('LoL')), `sport leaked into "${t.id}"`);
    }
  });

  test('the counts on the buttons match what pressing them shows', () => {
    // The counts exist so a button cannot promise rows it does not have.
    const counts = countByTopic(rows, 'small');
    for (const t of TOPIC_TABS) {
      assert.equal(
        counts.get(t.id),
        selectTrades(rows, { band: 'small', topic: t.id, limit: Infinity }).length,
        `"${t.id}" counted wrong`,
      );
    }
  });

  test('counts follow the band, not the whole feed', () => {
    const big = [trade({ title: 'Fed rate cut in September?', size: 1e6, price: 0.75 })];
    assert.equal(countByTopic(big, 'small').get('fed'), 0);
    assert.equal(countByTopic(big, 'large').get('fed'), 1);
  });

  test('"all macro" is offered first, before the subjects', () => {
    assert.equal(TOPIC_TABS[0].id, 'all');
    assert.ok(TOPIC_TABS.some((t) => t.id === 'fed'), 'the Fed must have its own button');
  });

  test('an unknown subject shows nothing rather than everything', () => {
    assert.equal(selectTrades(rows, { band: 'small', topic: 'sport' }).length, 0);
  });
});

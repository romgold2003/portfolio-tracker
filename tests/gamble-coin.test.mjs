/**
 * Crypto price markets in the macro panel.
 *
 * Asked for by name: whether Bitcoin ends the month higher, whether it is up in
 * the next fifteen minutes, and the rest of that family. They were left out at
 * first because the short-dated ones are numerous enough to swamp a Fed trade.
 *
 * Two halves are required, a coin and something about where its price goes, and
 * the pair is what keeps the subjects apart. Bitcoin alone would take every ETF
 * approval and every regulatory market; a price word alone would take equities
 * and gold. Crypto policy is matched first on purpose — a strategic bitcoin
 * reserve is a question about a government, not about what Bitcoin is worth.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { topicOf, TOPIC_TABS, BANDS, selectTrades, countByTopic } from '../src/services/gamble.js';

const subject = (title) => topicOf(title)?.id ?? null;

describe('the markets that were asked for', () => {
  const wanted = [
    'Bitcoin Up or Down - September 24, 3PM ET',
    'Bitcoin Up or Down - September 23, 2:10PM-2:15PM ET',
    'Will Bitcoin be higher at the end of September?',
    'Will the price of Bitcoin be above $84,000 on September 23?',
    'Will Bitcoin dip to $40,000 by December 31, 2026?',
    'Ethereum all-time high before July?',
    'Will Solana hit $500 in 2026?',
    'XRP above $3 on October 31?',
    'Will Dogecoin reach $1?',
    'Crypto market cap above $5T in 2026?',
    'What price will Bitcoin close at on Friday?',
  ];
  for (const title of wanted) {
    test(title, () => assert.equal(subject(title), 'coin'));
  }
});

describe('what it must not swallow', () => {
  test('a government question about Bitcoin is policy, not price', () => {
    assert.equal(subject('Will the US establish a Strategic Bitcoin Reserve in 2026?'), 'policy');
    assert.equal(subject('Will the SEC approve a Solana ETF in 2026?'), 'policy');
  });

  test('a coin with nothing about its price is not a price market', () => {
    assert.equal(subject('Will Coinbase list a new Ethereum product?'), null);
  });

  test('a price with no coin belongs to whatever else it is', () => {
    assert.equal(subject('Will gold hit $5,000 an ounce?'), null);
    assert.equal(subject('Will the S&P 500 close above 7000 this year?'), null);
  });

  test('the other subjects are untouched', () => {
    assert.equal(subject('Fed decision in September: 25 bps cut?'), 'fed');
    assert.equal(subject('Will Israel strike Iran before 2027?'), 'geo');
    assert.equal(subject('Will Trump win the 2028 election?'), 'polit');
    assert.equal(subject('Will there be a recession in 2026?'), 'econ');
  });
});

describe('it joins the panel on the same terms as everything else', () => {
  test('as its own tab, so a busy day for Bitcoin hides nothing', () => {
    const ids = TOPIC_TABS.map((t) => t.id);
    assert.ok(ids.includes('coin'));
    assert.equal(ids[0], 'all', 'everything still comes first');
  });

  test('with the same money bands as the other subjects', () => {
    assert.deepEqual(BANDS.map((b) => b.label), ['$250k–500k', '$500k–1M', '$1M+']);
  });

  const feed = [
    { title: 'Bitcoin Up or Down - September 24, 3PM ET', proxyWallet: '0xaaaaaaaaaaaaaaaaaaaa', size: 600_000, price: 0.5, side: 'BUY', outcome: 'Up', timestamp: 200 },
    { title: 'Fed decision in September: 25 bps cut?', proxyWallet: '0xbbbbbbbbbbbbbbbbbbbb', size: 400_000, price: 0.8, side: 'BUY', outcome: 'Yes', timestamp: 100 },
  ];

  test('a big enough crypto bet appears in its band', () => {
    // 600,000 shares at 50c is $300,000.
    const rows = selectTrades(feed, { band: 'mid', topic: 'coin' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].usd, 300_000);
    assert.equal(rows[0].topicLabel, 'Crypto prices');
  });

  test('and is counted on its own button, and in the total', () => {
    const counts = countByTopic(feed, 'mid');
    assert.equal(counts.get('coin'), 1);
    assert.equal(counts.get('fed'), 1);
    assert.equal(counts.get('all'), 2);
  });

  test('below the floor it is not shown, exactly like any other subject', () => {
    // The largest crypto-price bet seen on the live feed was about $50,000.
    const small = [{ ...feed[0], size: 100_000, price: 0.5 }];
    assert.deepEqual(selectTrades(small, { band: 'mid', topic: 'coin' }), []);
  });
});

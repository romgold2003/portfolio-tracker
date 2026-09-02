/**
 * Reading the two fear-and-greed indices out of the source page.
 *
 * The value is taken from the structured payload the page already serves rather
 * than from what it drew, so these are really about one thing: when the shape
 * is not what was expected, say nothing. A dial showing a confident wrong
 * number is worse than no dial, because nothing on screen says it is wrong.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { readSentiment, bandFor, extractNextData } from '../api/_lib/sentiment.js';

const page = (data) =>
  `<html><head><title>x</title></head><body><div>drawn</div>
   <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>
   </body></html>`;

/** The shape the real page carries. */
const real = {
  props: {
    pageProps: {
      data: {
        fgi: { latest: { now: 31, previous_close: 45, date: '2026-09-02' } },
        fgi_crypto: [{ value: '63' }],
        fgi_crypto_cmc: [{ value: 69, previous_close: 75 }],
      },
    },
  },
};

describe('the bands', () => {
  // The published boundaries, which are easy to be one out on.
  const cases = [
    [0, 'Extreme Fear'], [24, 'Extreme Fear'],
    [25, 'Fear'], [44, 'Fear'],
    [45, 'Neutral'], [55, 'Neutral'],
    [56, 'Greed'], [75, 'Greed'],
    [76, 'Extreme Greed'], [100, 'Extreme Greed'],
  ];
  for (const [value, label] of cases) {
    test(`${value} is ${label}`, () => assert.equal(bandFor(value), label));
  }
});

describe('reading the page', () => {
  test('takes both indices', () => {
    const s = readSentiment(page(real));
    assert.deepEqual(s.stocks, { value: 31, label: 'Fear', previous: 45 });
    assert.deepEqual(s.crypto, { value: 69, label: 'Greed', previous: 75 });
    assert.equal(s.date, '2026-09-02');
  });

  test('prefers CoinMarketCap for crypto, which is the one asked for', () => {
    // The two indices sit side by side and disagree; 69 is CMC's.
    assert.equal(readSentiment(page(real)).crypto.value, 69);
  });

  test('falls back to the other crypto index when CMC is absent', () => {
    const without = structuredClone(real);
    delete without.props.pageProps.data.fgi_crypto_cmc;
    assert.equal(readSentiment(page(without)).crypto.value, 63);
  });

  test('still answers when only one of the two is there', () => {
    const stocksOnly = structuredClone(real);
    delete stocksOnly.props.pageProps.data.fgi_crypto;
    delete stocksOnly.props.pageProps.data.fgi_crypto_cmc;
    const s = readSentiment(page(stocksOnly));
    assert.equal(s.stocks.value, 31);
    assert.equal(s.crypto, null);
  });
});

describe('refusing to guess', () => {
  test('a page with no payload', () => {
    assert.equal(readSentiment('<html><body>nothing here</body></html>'), null);
    assert.equal(extractNextData('<html></html>'), null);
  });

  test('a payload that is not JSON', () => {
    assert.equal(readSentiment('<script id="__NEXT_DATA__">{oh dear</script>'), null);
  });

  test('a redesigned page with the data moved', () => {
    assert.equal(readSentiment(page({ props: { pageProps: {} } })), null);
  });

  test('a reading outside the scale is no reading', () => {
    const broken = structuredClone(real);
    broken.props.pageProps.data.fgi.latest.now = 240;
    broken.props.pageProps.data.fgi_crypto_cmc[0].value = -5;
    broken.props.pageProps.data.fgi_crypto[0].value = 'soon';
    assert.equal(readSentiment(page(broken)), null);
  });

  test('nothing at all', () => {
    assert.equal(readSentiment(''), null);
    assert.equal(readSentiment(null), null);
    assert.equal(readSentiment(undefined), null);
  });
});

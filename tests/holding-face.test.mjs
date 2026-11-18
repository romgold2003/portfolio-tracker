/**
 * The holding rows' face (Clavis, November 2026): a coloured bubble with the
 * ticker, the size under the name, and the value over its return on a phone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { bubbleHtml, sizeLabel, identHtml, sparkHtml } = await import('../src/ui/views/holdingColumns.js');

test('a ticker keeps one colour everywhere, and long tickers get a smaller type', () => {
  assert.equal(bubbleHtml('NVDA'), bubbleHtml('nvda'));
  assert.notEqual(bubbleHtml('NVDA').match(/--hb-h:(\d+)/)[1], bubbleHtml('SPY').match(/--hb-h:(\d+)/)[1]);
  assert.match(bubbleHtml('SPY'), /font-size:13px/);
  assert.match(bubbleHtml('GOOGL'), /font-size:9.5px/);
});

test('the size reads as shares, or in the coin for crypto', () => {
  assert.equal(sizeLabel({ ticker: 'NVDA', cls: 'Stocks', qty: 32 }), '32 shares');
  assert.equal(sizeLabel({ ticker: 'AAPL', cls: 'Stocks', qty: 1 }), '1 share');
  assert.equal(sizeLabel({ ticker: 'BTC', cls: 'Crypto', qty: 0.05 }), '0.05 BTC');
});

test('a short says so beside the name; a long needs no label', () => {
  assert.match(identHtml({ ticker: 'USO', dir: 'Short', cls: 'Stocks', qty: 5 }), /hid-short">Short/);
  assert.doesNotMatch(identHtml({ ticker: 'NVDA', dir: 'Long', cls: 'Stocks', qty: 5 }), /Long|hid-short/);
});

test('no line until there is a price history to draw', () => {
  assert.doesNotMatch(sparkHtml({ ticker: 'NVDA', dir: 'Long', cur: 100 }), /polyline/);
});

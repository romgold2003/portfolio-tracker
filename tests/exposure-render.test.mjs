/**
 * The options panel has to actually draw.
 *
 * On 1 October 2026 a cleanup removed the declaration of `lastPick` while the
 * code still assigned to it. In a module that is a ReferenceError, thrown on
 * the first line of renderExposure — so the card showed its frame and nothing
 * else: no market buttons, no strike chart, no history. It also stopped
 * renderNews part-way, before the News tabs were wired. Every test passed,
 * because none of them ran the panel; they checked its pieces.
 *
 * This one runs it, against a minimal stand-in for the page.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/** Just enough of an element for the panel's drawing code. */
function fakeElement(id) {
  return {
    id,
    innerHTML: '',
    textContent: '',
    hidden: false,
    style: {},
    dataset: {},
    onclick: null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

let realDocument;
let elements;

beforeEach(() => {
  realDocument = globalThis.document;
  elements = new Map();
  globalThis.document = {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, fakeElement(id));
      return elements.get(id);
    },
    querySelectorAll: () => [],
  };
});

afterEach(() => {
  globalThis.document = realDocument;
});

const profile = (market = 'BTC') => ({
  market,
  label: 'Bitcoin',
  markets: [
    { id: 'BTC', label: 'Bitcoin', group: 'Crypto' },
    { id: 'ETH', label: 'Ethereum', group: 'Crypto' },
    { id: 'SPX', label: 'S&P 500', group: 'Indices' },
    { id: 'NDX', label: 'Nasdaq 100', group: 'Indices' },
  ],
  spot: 84700,
  netGex: 271e6,
  netDex: 5.5e9,
  maxPain: 79000,
  band: { pct: 20 },
  strikes: [
    { strike: 80000, gex: -3e6, dex: 1e8, oi: 100 },
    { strike: 84000, gex: 12e6, dex: 2e8, oi: 300 },
    { strike: 88000, gex: 5e6, dex: 3e8, oi: 200 },
  ],
  source: { name: 'Deribit', note: 'live order book' },
  struck: '2026-10-02T08:00:00Z',
  history: [],
});

describe('renderExposure', () => {
  test('draws without throwing', async () => {
    const { renderExposure } = await import('../src/ui/views/exposure.js');
    assert.doesNotThrow(() => renderExposure(profile(), () => {}));
  });

  test('offers BTC, ETH, S&P and Nasdaq, with the current one marked', async () => {
    const { renderExposure } = await import('../src/ui/views/exposure.js');
    renderExposure(profile('ETH'), () => {});
    const picker = elements.get('optPicker').innerHTML;
    for (const id of ['BTC', 'ETH', 'SPX', 'NDX']) assert.match(picker, new RegExp(`data-market="${id}"`), id);
    assert.match(picker, /class="opt-tab active"\s+data-market="ETH"/);
  });

  test('a market button calls back with that market', async () => {
    const { renderExposure } = await import('../src/ui/views/exposure.js');
    const picked = [];
    renderExposure(profile(), (id) => picked.push(id));
    elements.get('optPicker').onclick({ target: { dataset: { market: 'SPX' } } });
    assert.deepEqual(picked, ['SPX']);
  });

  test('draws GEX by strike and DEX', async () => {
    const { renderExposure } = await import('../src/ui/views/exposure.js');
    renderExposure(profile(), () => {});
    assert.match(elements.get('optGexNow').innerHTML, /class="xn-bar"/);
    assert.match(elements.get('optDexNow').innerHTML, /DEX · Delta exposure/);
    assert.match(elements.get('optSpot').innerHTML, /\$84,700/);
  });
});

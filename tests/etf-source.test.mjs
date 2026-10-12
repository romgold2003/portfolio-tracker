/**
 * Spot ETF flows after SoSoValue closed its open API (October 2026).
 *
 * api.sosovalue.xyz began answering 404, "接口不存在" — no such endpoint — and
 * the panel on the Crypto page simply vanished. The same call now lives at
 * openapi.sosovalue.com behind a free key, set on Vercel as SOSO_API_KEY.
 * Until it is set the card says so rather than disappearing again.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../api/_panels/etf.js', import.meta.url), 'utf8');

describe('the source', () => {
  test('is the keyed API, with the key in the header SoSoValue reads', () => {
    assert.match(source, /https:\/\/openapi\.sosovalue\.com\/openapi\/v2\/etf\/historicalInflowChart/);
    assert.doesNotMatch(source, /const ENDPOINT = 'https:\/\/api\.sosovalue\.xyz/);
    assert.match(source, /'x-soso-api-key': key/);
    assert.match(source, /process\.env\.SOSO_API_KEY/);
  });
});

describe('the card', () => {
  let renderEtfFlows;
  const nodes = {};
  let realDocument;

  beforeEach(async () => {
    realDocument = globalThis.document;
    for (const id of ['etfCard', 'etfBody', 'etfGrain']) nodes[id] = { style: {}, innerHTML: '' };
    globalThis.document = { getElementById: (id) => nodes[id] ?? null, querySelector: () => null, querySelectorAll: () => [] };
    ({ renderEtfFlows } = await import('../src/ui/views/exposure.js'));
  });

  afterEach(() => { globalThis.document = realDocument; });

  test('says why it is empty instead of vanishing', () => {
    renderEtfFlows({ error: 'ETF flows need a SoSoValue API key, which is not set yet.' });
    assert.equal(nodes.etfCard.style.display, '');
    assert.match(nodes.etfBody.innerHTML, /SoSoValue API key/);
  });

  test('and the reason is text, never markup', () => {
    renderEtfFlows({ error: '<img src=x onerror=alert(1)>' });
    assert.doesNotMatch(nodes.etfBody.innerHTML, /<img/);
  });
});

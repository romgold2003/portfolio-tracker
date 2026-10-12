/**
 * Spot ETF flows after SoSoValue closed its open API (October 2026).
 *
 * api.sosovalue.xyz began answering 404, "接口不存在" — no such endpoint — and
 * the panel on the Crypto page simply vanished. CoinMarketCap's chart data now
 * supplies it with no key: daily for 90 days, weekly for a year, monthly to
 * launch. SoSoValue's keyed API stands in if SOSO_API_KEY is ever set. If
 * nothing answers, the card says so rather than disappearing.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../api/_panels/etf.js', import.meta.url), 'utf8');

describe('the source', () => {
  let realFetch;
  let flowsFor;
  let parseCmc;
  let SERIES;
  const calls = [];
  const point = (day, m) => ({ value: m * 1e6, btcValue: m * 1e6, ethValue: 0, timestamp: String(Date.parse(day)) });
  const CMC = {
    '90d': [point('2026-10-08', -244.1), point('2026-10-09', 21.1)],
    '1y': [point('2026-09-28', 73.9), point('2026-10-05', -686.7)],
    all: [point('2026-09-01', 2545.3), point('2026-10-01', -403.1)],
  };

  beforeEach(async () => {
    realFetch = globalThis.fetch;
    calls.length = 0;
    delete process.env.SOSO_API_KEY;
    ({ flowsFor } = await import('../api/_panels/etf.js'));
    ({ parseCmc, SERIES } = await import('../api/_lib/etfflows.js'));
  });
  afterEach(() => { globalThis.fetch = realFetch; delete process.env.SOSO_API_KEY; });

  const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const down = { ok: false, status: 403, json: async () => ({}), text: async () => '' };

  test("CoinMarketCap's points are dollars by timestamp; the chart carries millions by day", () => {
    assert.deepEqual(parseCmc({ data: { points: CMC['90d'] } }), [
      { date: '2026-10-08', flow: -244.1 }, { date: '2026-10-09', flow: 21.1 },
    ]);
    assert.equal(parseCmc({ data: { points: [{ value: null, timestamp: '1' }] } }), null, 'no figure is no day, not a zero');
  });

  test('it answers with no key, and sends its own weekly and monthly totals beside the days', async () => {
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      const range = new URL(url).searchParams.get('range');
      return ok({ data: { points: CMC[range] } });
    };
    const r = await flowsFor(SERIES.BTC);
    assert.equal(r.source, 'CoinMarketCap');
    assert.deepEqual(r.daily.map((d) => d.flow), [-244.1, 21.1]);
    assert.deepEqual(r.weekly.map((d) => d.date), ['2026-09-28', '2026-10-05']);
    assert.deepEqual(r.monthly.map((d) => d.flow), [2545.3, -403.1]);
    assert.ok(calls.every((c) => c.init.headers['User-Agent'] === 'portfolio-tracker'), 'it says who it is');
  });

  test('SoSoValue only with a key, in the header it reads', async () => {
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('coinmarketcap')) return down;
      return ok({ data: [{ date: '2026-10-09', totalNetInflow: 21100000 }] });
    };
    await assert.rejects(flowsFor(SERIES.BTC), 'no key, no SoSoValue');
    assert.ok(!calls.some((c) => c.url.includes('sosovalue')));

    process.env.SOSO_API_KEY = 'k';
    const r = await flowsFor(SERIES.BTC);
    assert.equal(r.source, 'SoSoValue');
    const soso = calls.find((c) => c.url.includes('sosovalue'));
    assert.equal(soso.url, 'https://openapi.sosovalue.com/openapi/v2/etf/historicalInflowChart');
    assert.equal(soso.init.headers['x-soso-api-key'], 'k');
  });

  test('the closed address is gone from the code', () => {
    assert.doesNotMatch(source, /api\.sosovalue\.xyz/);
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

describe('the three views', () => {
  test("weekly and monthly take the source's own totals, which reach further than its 90 days", () => {
    const view = readFileSync(new URL('../src/ui/views/exposure.js', import.meta.url), 'utf8');
    assert.ok(view.includes('rollUp(set[grain]?.length ? set[grain] : set.flows, grain)'));
  });
});

/**
 * Stablecoin dominance at the top of the Crypto page, beside the fear-and-greed
 * dials.
 *
 * Every stablecoin's share, not Tether's alone: Romy asked for USDT.D first,
 * then for the whole of it (October 2026). TradingView's STABLE.C.D first,
 * because it is the one on Romy's charts — 10.67% on 2 October 2026. Its
 * endpoint is public but undocumented, a trade-off Romy chose; if it stops
 * answering, the app's own sum over CoinGecko's total stands in.
 *
 * Sources are never mixed, and each says which it was and over what window it
 * measured: TradingView from its daily open, CoinGecko over 24 hours.
 *
 * CoinGecko gives no 24-hour move for the share itself, so it is recovered:
 * a cap that moved by u per cent was cap / (1 + u) a day ago.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fetchGlobal, stableChange24h, stableShare, resetTotalCache } from '../api/_lib/stablecoins.js';
import { stableTileHtml } from '../src/ui/views/whaleOverview.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
// 403, not 429: CoinGecko's helper waits out a 429, and these tests have no clock to wait on.
const refused = async () => ({ ok: false, status: 403, json: async () => ({}) });

/** A fetcher that routes by host: TradingView or CoinGecko. */
function sources({ tv, cg } = {}, calls = []) {
  return async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('tradingview')) return tv ? ok(tv) : refused();
    if (u.includes('coingecko')) return cg ? ok({ data: cg }) : refused();
    return refused();
  };
}

const TV = { close: 10.6714, change_abs: -0.1761 };
const CG = { total_market_cap: { usd: 3e12 }, market_cap_change_percentage_24h_usd: -0.5 };
const coins = [
  { symbol: 'USDT', marketCap: 184e9, marketCapChange24h: 0.05 },
  { symbol: 'USDC', marketCap: 74e9, marketCapChange24h: 0.1 },
  { symbol: 'BTC', marketCap: 2e12, marketCapChange24h: -1 },
];

describe('the recovered 24-hour move', () => {
  const stables = coins.slice(0, 2);

  test('unchanged market caps mean an unchanged share', () => {
    assert.ok(Math.abs(stableChange24h(stables.map((c) => ({ ...c, marketCapChange24h: 0 })), 3e12, 0)) < 1e-12);
  });

  test('the market falling while the dollars hold lifts their share, by exactly the right amount', () => {
    const flat = [{ symbol: 'USDT', marketCap: 300e9, marketCapChange24h: 0 }];
    // 300 of 3000 now; the market was 3000 / 0.9 a day ago.
    assert.ok(Math.abs(stableChange24h(flat, 3e12, -10) - (10 - 9)) < 1e-9);
  });

  test('the dollars growing faster than the market lifts it; slower lowers it', () => {
    assert.ok(stableChange24h(stables, 3e12, 0) > 0);
    assert.ok(stableChange24h(stables, 3e12, 2) < 0);
  });

  test('a missing input is no answer, not a zero', () => {
    assert.equal(stableChange24h(stables, 3e12, null), null);
    assert.equal(stableChange24h([{ symbol: 'USDT', marketCap: 1e9 }], 3e12, 0.3), null);
    assert.equal(stableChange24h([], 3e12, 0.3), null);
  });
});

describe('CoinGecko\'s global figures', () => {
  test('give the total and the market\'s 24h change in one call', async () => {
    const g = await fetchGlobal({ fetcher: async () => ok({ data: CG }) });
    assert.deepEqual(g, { totalUsd: 3e12, totalChange24h: -0.5 });
  });
});

describe('which source answers', () => {
  beforeEach(() => resetTotalCache());

  test('TradingView\'s STABLE.C.D first — every stablecoin, not USDT.D', async () => {
    const calls = [];
    const u = await stableShare({ coins, fetcher: sources({ tv: TV, cg: CG }, calls) });
    assert.deepEqual(u, { dominance: 10.6714, change: -0.1761, window: 'today', source: 'TradingView' });
    assert.match(calls[0], /CRYPTOCAP%3ASTABLE\.C\.D/);
    assert.doesNotMatch(calls[0], /USDT\.D/);
  });

  test('the app\'s own sum when TradingView fails, its inputs all CoinGecko\'s', async () => {
    const u = await stableShare({ coins, fetcher: sources({ cg: CG }) });
    assert.equal(u.source, 'CoinGecko');
    assert.equal(u.window, '24h');
    assert.ok(Math.abs(u.dominance - (258e9 / 3e12) * 100) < 1e-9, 'the dollars only, never BTC');
    assert.ok(Math.abs(u.change - stableChange24h(coins.slice(0, 2), 3e12, -0.5)) < 1e-12);
  });

  test('a TradingView answer that is not a plausible percentage is not believed', async () => {
    const u = await stableShare({ coins, fetcher: sources({ tv: { close: 0 }, cg: CG }) });
    assert.equal(u.source, 'CoinGecko');
  });

  test('nothing answering is no figure, not a wrong one', async () => {
    assert.equal(await stableShare({ coins, fetcher: sources({}) }), null);
  });

  test('TradingView is asked at most once every two minutes', async () => {
    const calls = [];
    const fetcher = sources({ tv: TV }, calls);
    const t0 = Date.parse('2026-10-02T10:00:00Z');
    const tv = () => calls.filter((u) => u.includes('tradingview')).length;
    await stableShare({ coins, fetcher, now: t0 });
    await stableShare({ coins, fetcher, now: t0 + 60_000 });
    assert.equal(tv(), 1);
    await stableShare({ coins, fetcher, now: t0 + 3 * 60_000 });
    assert.equal(tv(), 2);
  });
});

describe('on the wire', () => {
  const whales = readFileSync(new URL('../api/_panels/whales.js', import.meta.url), 'utf8');

  test('the header figure is fetched beside the dominance, not after it', () => {
    // After it, a slow CoinGecko ran the dominance into its fallback and took
    // the header figure with it.
    assert.match(whales, /stables: withHeadline\(\.\.\.await Promise\.all\(\[/);
    assert.match(whales, /withBudget\(stablecoins\.stableShare\(\{\s*\/\/[^\n]*\n\s*coins: \(\) => topCoins\(\)/);
  });

  test('and does not wait for the coin list, which only the fallback needs', async () => {
    resetTotalCache();
    let asked = false;
    const u = await stableShare({ coins: async () => { asked = true; return []; }, fetcher: sources({ tv: TV }) });
    assert.equal(u.source, 'TradingView');
    assert.equal(asked, false, 'TradingView answering means the list is never fetched');
  });
});

describe('the tile', () => {
  test('reads like the dials: the figure, the move and its window, the name', () => {
    const html = stableTileHtml({ dominance: 10.6714, change: -0.1761, window: 'today', source: 'TradingView' });
    assert.match(html, /10\.67%/);
    assert.match(html, /▼ 0\.18 · today/);
    assert.match(html, /Stablecoin dominance/);
    assert.doesNotMatch(html, /USDT/);
  });

  test('labels the fallback\'s move as 24 hours, which is what it measures', () => {
    assert.match(stableTileHtml({ dominance: 11.2, change: 0.021, window: '24h' }), /▲ 0\.02 · 24h/);
  });

  test('a flat move is flat; an unknown one says so; no reading shows nothing', () => {
    assert.match(stableTileHtml({ dominance: 10.6, change: 0.001, window: 'today' }), /· 0\.00 · today/);
    assert.match(stableTileHtml({ dominance: 10.6, change: null }), /change unavailable/);
    assert.equal(stableTileHtml(null), '');
    assert.equal(stableTileHtml({}), '');
  });

  test('sits in the Crypto page\'s header, after the dials', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const page = html.slice(html.indexOf('<div id="crypto" class="page'));
    const bar = page.slice(0, page.indexOf('id="cryptoTabs"'));
    assert.ok(bar.indexOf('data-gauges') >= 0 && bar.indexOf('id="stableDominance"') > bar.indexOf('data-gauges'));
  });
});

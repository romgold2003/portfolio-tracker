/**
 * USDT dominance at the top of the Crypto page, beside the fear-and-greed dials.
 *
 * Tether alone — USDT.D, about six per cent — not the all-stablecoin share the
 * whale card shows, which is about twelve. TradingView's figure first, because
 * it is the one on Romy's charts: on 2 October 2026 it read 6.33%, against
 * CoinGecko's 6.23% and CoinPaprika's 6.00%. Its endpoint is public but
 * undocumented, a trade-off Romy chose; if it stops answering, CoinGecko stands
 * in when the server already has its figure, and CoinPaprika otherwise.
 *
 * Sources are never mixed, and each says which it was and over what window it
 * measured: TradingView from its daily open, the others over 24 hours.
 *
 * Where a source gives no 24-hour move for the share itself it is recovered:
 * Tether's market cap moved by u per cent and the whole market's by t, so the
 * share a day ago was share × (1 + t) / (1 + u).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fetchGlobal, usdtChange24h, current, usdtShare, resetTotalCache } from '../api/_lib/stablecoins.js';
import { usdtTileHtml } from '../src/ui/views/whaleOverview.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const refused = async () => ({ ok: false, status: 429, json: async () => ({}) });

/** A fetcher that routes by host: TradingView, CoinGecko, CoinPaprika. */
function sources({ tv, cg, paprika } = {}, calls = []) {
  return async (url) => {
    const u = String(url);
    calls.push(new URL(u).host);
    if (u.includes('tradingview')) return tv ? ok(tv) : refused();
    if (u.includes('coingecko')) return cg ? ok({ data: cg }) : refused();
    if (u.includes('coinpaprika')) {
      if (!paprika) return refused();
      return ok(u.endsWith('/global') ? paprika.global : paprika.tether);
    }
    return refused();
  };
}

const TV = { close: 6.3269, change_abs: -0.0949 };
const CG = {
  total_market_cap: { usd: 3.1e12 },
  market_cap_percentage: { usdt: 6.23 },
  market_cap_change_percentage_24h_usd: -0.32,
};
const PAPRIKA = {
  global: { market_cap_usd: 3.069e12, market_cap_change_24h: 2.27 },
  tether: { quotes: { USD: { market_cap: 184e9, market_cap_change_24h: 0.13 } } },
};
const coins = [
  { symbol: 'USDT', marketCap: 193e9, marketCapChange24h: 0.05 },
  { symbol: 'USDC', marketCap: 75e9, marketCapChange24h: 0.1 },
];

describe('the recovered 24-hour move', () => {
  test('unchanged market caps mean an unchanged share', () => {
    assert.equal(usdtChange24h(6.2, 0, 0), 0);
  });

  test('the market falling while Tether holds lifts its share, by exactly the right amount', () => {
    const now = 6 / 0.9; // 6% a day ago, market down 10%, Tether flat
    assert.ok(Math.abs(usdtChange24h(now, 0, -10) - (now - 6)) < 1e-9);
  });

  test('Tether growing faster than the market lifts it; slower lowers it', () => {
    assert.ok(usdtChange24h(6.2, 1, 0) > 0);
    assert.ok(usdtChange24h(6.2, -1, 2) < 0);
  });

  test('a missing input is no answer, not a zero', () => {
    assert.equal(usdtChange24h(6.2, null, 0.3), null);
    assert.equal(usdtChange24h(null, 0.1, 0.3), null);
  });
});

describe('CoinGecko\'s global figures', () => {
  test('give the total, Tether\'s share and the market\'s 24h change in one call', async () => {
    const g = await fetchGlobal({ fetcher: async () => ok({ data: CG }) });
    assert.deepEqual(g, { totalUsd: 3.1e12, usdtPct: 6.23, totalChange24h: -0.32 });
  });
});

describe('which source answers', () => {
  beforeEach(() => resetTotalCache());

  test('TradingView first — the figure on Romy\'s charts, measured from the daily open', async () => {
    const u = await usdtShare({ coins, fetcher: sources({ tv: TV, cg: CG, paprika: PAPRIKA }) });
    assert.deepEqual(u, { dominance: 6.3269, change: -0.0949, window: 'today', source: 'TradingView' });
  });

  test('CoinGecko when TradingView fails and the server already holds its figure', async () => {
    await current({ coins, fetcher: async () => ok({ data: CG }) });
    const calls = [];
    const u = await usdtShare({ coins, fetcher: sources({ paprika: PAPRIKA }, calls) });
    assert.equal(u.source, 'CoinGecko');
    assert.equal(u.window, '24h');
    assert.ok(Math.abs(u.change - usdtChange24h(6.23, 0.05, -0.32)) < 1e-12);
    assert.ok(!calls.includes('api.coinpaprika.com'), 'no need to ask CoinPaprika');
  });

  test('CoinPaprika as the last resort, every input its own', async () => {
    const u = await usdtShare({ coins, fetcher: sources({ paprika: PAPRIKA }) });
    assert.equal(u.source, 'CoinPaprika');
    assert.ok(Math.abs(u.dominance - (184e9 / 3.069e12) * 100) < 1e-9);
    // CoinPaprika's own market change, never CoinGecko's: the windows differ.
    assert.ok(Math.abs(u.change - usdtChange24h(u.dominance, 0.13, 2.27)) < 1e-12);
  });

  test('a TradingView answer that is not a plausible percentage is not believed', async () => {
    const u = await usdtShare({ coins, fetcher: sources({ tv: { close: 0 }, paprika: PAPRIKA }) });
    assert.equal(u.source, 'CoinPaprika');
  });

  test('nothing answering is no figure, not a wrong one', async () => {
    await assert.rejects(usdtShare({ coins, fetcher: sources({}) }));
  });

  test('TradingView is asked at most once every two minutes', async () => {
    const calls = [];
    const fetcher = sources({ tv: TV }, calls);
    const t0 = Date.parse('2026-10-02T10:00:00Z');
    await usdtShare({ coins, fetcher, now: t0 });
    await usdtShare({ coins, fetcher, now: t0 + 60_000 });
    assert.equal(calls.filter((h) => h.includes('tradingview')).length, 1);
    await usdtShare({ coins, fetcher, now: t0 + 3 * 60_000 });
    assert.equal(calls.filter((h) => h.includes('tradingview')).length, 2);
  });
});

describe('on the wire', () => {
  const whales = readFileSync(new URL('../api/_panels/whales.js', import.meta.url), 'utf8');

  test('Tether\'s figure is fetched beside the dominance, not after it', () => {
    // After it, a slow CoinGecko ran the dominance into its fallback and took
    // Tether's figure with it.
    assert.match(whales, /stables: withTether\(\.\.\.await Promise\.all\(\[/);
    assert.match(whales, /withBudget\(stablecoins\.usdtShare\(\{\s*\/\/[^\n]*\n\s*coins: \(\) => topCoins\(\)/);
  });

  test('and does not wait for the coin list, which only a fallback needs', async () => {
    resetTotalCache();
    let asked = false;
    const u = await usdtShare({ coins: async () => { asked = true; return []; }, fetcher: sources({ tv: TV }) });
    assert.equal(u.source, 'TradingView');
    assert.equal(asked, false, 'TradingView answering means the list is never fetched');
  });
});

describe('the tile', () => {
  test('reads like the dials: the figure, the move and its window, the name', () => {
    const html = usdtTileHtml({ dominance: 6.3269, change: -0.0949, window: 'today', source: 'TradingView' });
    assert.match(html, /6\.33%/);
    assert.match(html, /▼ 0\.09 · today/);
    assert.match(html, /USDT dominance/);
  });

  test('labels a fallback\'s move as 24 hours, which is what it measures', () => {
    assert.match(usdtTileHtml({ dominance: 6.23, change: 0.021, window: '24h' }), /▲ 0\.02 · 24h/);
  });

  test('a flat move is flat; an unknown one says so; no reading shows nothing', () => {
    assert.match(usdtTileHtml({ dominance: 6.2, change: 0.001, window: 'today' }), /· 0\.00 · today/);
    assert.match(usdtTileHtml({ dominance: 6.2, change: null }), /change unavailable/);
    assert.equal(usdtTileHtml(null), '');
    assert.equal(usdtTileHtml({}), '');
  });

  test('sits in the Crypto page\'s header, after the dials', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const page = html.slice(html.indexOf('<div id="crypto" class="page'));
    const bar = page.slice(0, page.indexOf('id="cryptoTabs"'));
    assert.ok(bar.indexOf('data-gauges') >= 0 && bar.indexOf('id="usdtDominance"') > bar.indexOf('data-gauges'));
  });
});

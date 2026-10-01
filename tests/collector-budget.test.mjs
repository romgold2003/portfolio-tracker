/**
 * The whale collectors have to answer, whatever their sources are doing.
 *
 * The Gamble → Crypto card's Spot and GMX rows are only ever written by a
 * GitHub Actions job. In late September its call to `/api/whales?resource=poll`
 * returned 504 on every run for four days: one of its jobs stalled, the
 * function ran into the platform's sixty-second cut, and the reply — which names
 * each job's failure — never got out. The workflow recorded "504" and nothing
 * else, and the card went quietly empty.
 *
 * Once the reply could get out, it said the next thing: GeckoTerminal refused
 * 13 of 17 spot calls with a 429. Its limit is per IP and the platform's
 * addresses are shared, so the spot reading moved onto the runner, which posts
 * what it reads back to the server.
 *
 * Tested here:
 *   - every upstream call carries a timeout, so one that never answers cannot
 *     hold a job open;
 *   - each poll job is held to a budget well inside sixty seconds, and the
 *     answer goes out either way, naming what ran out;
 *   - the server half of the spot split: what it hands the runner, and what it
 *     will and will not accept back.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { useDriver, query } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import { collectGmx } from '../api/_lib/gmxlev.js';
import {
  discoverPools, readTrades, spotPlan, storeSpot, cleanTrade, cleanPool, readSpot, FLOOR_USD,
} from '../api/_lib/dexspot.js';

/** A fetcher that answers at once, and notes whether each call could be cut short. */
function recordingFetcher(answer) {
  const calls = [];
  const fetcher = async (url, opts = {}) => {
    calls.push({ url: String(url), timed: opts.signal instanceof AbortSignal });
    return { ok: true, json: async () => answer(String(url)) };
  };
  return { fetcher, calls };
}

// One database for the file: the collectors remember they built their tables,
// and a fresh database under them each test would not have them.
before(() => {
  useDriver(sqliteDriver());
});

const NOW = Date.UTC(2026, 9, 1, 12);
const NOW_S = Math.floor(NOW / 1000);
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

describe('every upstream call can be cut short', () => {
  test('GMX: markets, tokens, trades, positions and backfill', async () => {
    const { fetcher, calls } = recordingFetcher((url) => {
      if (url.endsWith('/markets')) return { markets: [] };
      if (url.endsWith('/tokens')) return { tokens: [] };
      return { data: { tradeActions: [], positions: [] } };
    });
    await collectGmx({ now: NOW, fetcher });
    assert.ok(calls.length > 0, 'the collector made no calls at all');
    const bare = calls.filter((c) => !c.timed).map((c) => c.url);
    assert.deepEqual(bare, [], 'a call with no timeout can hold the whole poll');
  });

  test('spot: pool discovery and trade reads', async () => {
    const { fetcher, calls } = recordingFetcher(() => ({ data: [] }));
    await discoverPools('eth', WETH, { fetcher });
    await readTrades({ symbol: 'ETH', network: 'eth', token: WETH, pool: '0xpool', dex: 'uniswap' }, { fetcher });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.filter((c) => !c.timed).map((c) => c.url), []);
  });

  test('a call that never answers fails its job instead of hanging it', async () => {
    // Honour the abort the way real fetch does, and otherwise never resolve.
    const hanging = (url, opts = {}) => new Promise((_, reject) => {
      opts.signal?.addEventListener('abort', () => reject(opts.signal.reason));
    });
    const started = Date.now();
    const out = await collectGmx({ now: NOW, fetcher: hanging });
    const took = Date.now() - started;
    assert.ok(took < 45_000, `took ${took}ms — longer than the poll's budget`);
    assert.ok(out.failed.length > 0, 'the stall should be reported, not swallowed');
  });

  test('a refusal is an error the runner can see, not an empty answer', async () => {
    // The runner waits out a 429 and retries; it can only do that if the
    // refusal surfaces as an error rather than as "no trades".
    const refused = async () => ({ ok: false, status: 429, json: async () => ({}) });
    await assert.rejects(
      readTrades({ symbol: 'ETH', network: 'eth', token: WETH, pool: '0xpool' }, { fetcher: refused }),
      /GeckoTerminal answered 429/,
    );
  });
});

describe('the server\'s half of the spot split', () => {
  const listed = new Set(['ETH', 'LINK']);
  const trade = (over = {}) => ({
    at: NOW_S - 3_600, symbol: 'ETH', side: 'buy', amount: 250, usd: 900_000,
    address: '0xwhale', network: 'eth', dex: 'uniswap_v3', hash: '0xhash1', ...over,
  });

  test('a good trade is kept, with its id rebuilt rather than trusted', () => {
    const clean = cleanTrade({ ...trade(), id: 'someone-elses-id' }, listed, NOW);
    assert.equal(clean.id, 'eth:0xhash1:buy:ETH');
    assert.equal(clean.usd, 900_000);
  });

  test('and anything the panel could not honestly have been sent is refused', () => {
    const refused = {
      'a coin outside the top fifty': trade({ symbol: 'PEPE' }),
      'a side that is neither': trade({ side: 'hold' }),
      'under the floor': trade({ usd: FLOOR_USD - 1 }),
      'not a number': trade({ usd: 'lots' }),
      'no amount': trade({ amount: 0 }),
      'a network nobody reads': trade({ network: 'made-up-chain' }),
      'in the future': trade({ at: NOW_S + 3_600 }),
      'older than the store keeps': trade({ at: NOW_S - 400 * 86_400 }),
      'no hash': trade({ hash: '' }),
      'a hash the length of a novel': trade({ hash: 'x'.repeat(500) }),
    };
    for (const [why, t] of Object.entries(refused)) {
      assert.equal(cleanTrade(t, listed, NOW), null, why);
    }
  });

  test('pools are checked the same way', () => {
    assert.ok(cleanPool({ symbol: 'ETH', network: 'eth', token: WETH, pool: '0xpool', dex: 'uni' }, listed));
    assert.equal(cleanPool({ symbol: 'PEPE', network: 'eth', token: WETH, pool: '0xpool' }, listed), null);
    assert.equal(cleanPool({ symbol: 'ETH', network: 'eth', token: WETH, pool: '-' }, listed), null,
      "'-' is the server's own marker for 'no pool', not a pool");
  });

  test('stores what the runner sends, once, and the panel can read it', async () => {
    const first = await storeSpot({
      found: [{ symbol: 'ETH', network: 'eth', token: WETH, pool: '0xpool', dex: 'uniswap_v3' }],
      none: ['LINK'],
      trades: [trade(), trade({ hash: '0xhash2', side: 'sell' }), trade({ symbol: 'PEPE' })],
      listed,
      now: NOW,
    });
    assert.deepEqual(first, { pools: 1, trades: 2, written: 2, skipped: 1 });

    // The same run posted twice writes nothing new.
    const again = await storeSpot({ trades: [trade()], listed, now: NOW });
    assert.equal(again.written, 0);

    const shown = await readSpot({ since: NOW_S - 86_400 });
    assert.deepEqual(shown.map((r) => r.hash).sort(), ['0xhash1', '0xhash2']);
  });

  test('and plans the next run from what it stored', async () => {
    const plan = await spotPlan({
      coins: [{ id: 'ethereum', symbol: 'ETH' }, { id: 'chainlink', symbol: 'LINK' }],
      platformsOf: () => ({}),
    });
    assert.deepEqual(plan.pools.map((p) => p.pool), ['0xpool'], "LINK's '-' marker is not a pool to read");
    const eth = plan.coins.find((c) => c.symbol === 'ETH');
    assert.ok(eth.tokens.some(([n, t]) => n === 'eth' && t === WETH), 'ETH is found under WETH');
    assert.equal(eth.checked, NOW_S);
    assert.equal(plan.coins.find((c) => c.symbol === 'LINK').checked, NOW_S, 'searched, so not due again yet');
  });

  test('a coin that leaves the top fifty drops out of the plan', async () => {
    const plan = await spotPlan({ coins: [{ id: 'chainlink', symbol: 'LINK' }], platformsOf: () => ({}) });
    assert.deepEqual(plan.pools, []);
    const rows = (await query("SELECT COUNT(*) AS n FROM spot_pools WHERE symbol = 'ETH'", [])).rows;
    assert.equal(Number(rows[0].n), 1, 'but its pool is remembered for when it comes back');
  });
});

describe('the poll itself', () => {
  const src = readFileSync(new URL('../api/_panels/whales.js', import.meta.url), 'utf8');
  const poll = src.slice(src.indexOf("if (resource === 'poll')"), src.indexOf('const user = await userForToken'));

  test('holds each of its three jobs to a budget', () => {
    const budgeted = poll.match(/withBudget\(/g) ?? [];
    assert.equal(budgeted.length, 3, 'a job awaited outright can run the function into the 504');
  });

  test('and no longer reads spot trades itself', () => {
    assert.doesNotMatch(poll, /dexspot\.\w+\(/, 'GeckoTerminal refuses the platform\'s shared addresses');
  });

  test('a budget well inside the platform\'s sixty seconds', () => {
    const ms = Number(src.match(/const POLL_BUDGET_MS = ([\d_]+);/)?.[1]?.replace(/_/g, ''));
    assert.ok(ms > 0 && ms <= 50_000, `${ms}ms leaves no room to answer before the cut`);
  });

  test('and says which job ran out, rather than going silent', () => {
    assert.match(poll, /still running after/);
  });
});

describe('the workflow', () => {
  const yml = readFileSync(new URL('../.github/workflows/collect-whales.yml', import.meta.url), 'utf8');

  test('puts the server\'s reply in the warning, not just the status', () => {
    assert.match(yml, /::warning::the collector answered \$code: \$\{said/);
  });

  test('and flags a 200 whose jobs failed', () => {
    assert.match(yml, /answered 200 but a job failed/);
  });

  test('reads spot trades on the runner, even when the poll step fails', () => {
    assert.match(yml, /node scripts\/collect-spot\.mjs/);
    assert.match(yml, /if: always\(\)/);
    assert.match(yml, /actions\/checkout/, 'the script cannot run without the code');
  });
});

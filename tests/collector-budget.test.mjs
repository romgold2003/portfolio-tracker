/**
 * The scheduled collector has to answer, whatever its jobs are doing.
 *
 * The Gamble → Crypto card's Spot and GMX rows are only ever written by a
 * GitHub Actions job that calls `/api/whales?resource=poll` on a schedule. In
 * late September that call returned 504 on every run for four days: one of its
 * four jobs stalled, the function ran into the platform's sixty-second cut, and
 * the reply — which names each job's failure — never got out. The workflow
 * recorded "504" and nothing else, and the card went quietly empty.
 *
 * Two changes, tested here:
 *   - every upstream call made by the spot and GMX collectors carries a
 *     timeout, so one request that never answers cannot hold a job open;
 *   - each job is held to a budget well inside sixty seconds, and the answer
 *     goes out either way, naming what ran out.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { useDriver } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import { collectGmx } from '../api/_lib/gmxlev.js';
import { collectSpot } from '../api/_lib/dexspot.js';

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

describe('every upstream call can be cut short', () => {
  test('GMX: markets, tokens, trades, positions and backfill', async () => {
    const { fetcher, calls } = recordingFetcher((url) => {
      if (url.endsWith('/markets')) return { markets: [] };
      if (url.endsWith('/tokens')) return { tokens: [] };
      return { data: { tradeActions: [], positions: [] } };
    });
    await collectGmx({ now: Date.UTC(2026, 9, 1), fetcher });
    assert.ok(calls.length > 0, 'the collector made no calls at all');
    const bare = calls.filter((c) => !c.timed).map((c) => c.url);
    assert.deepEqual(bare, [], 'a call with no timeout can hold the whole poll');
  });

  test('spot: pool discovery and trade reads', async () => {
    const { fetcher, calls } = recordingFetcher(() => ({ data: [] }));
    const coins = [{ id: 'weth', symbol: 'WETH', rank: 1 }];
    await collectSpot({
      coins,
      platformsOf: () => ({ ethereum: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' }),
      now: Date.UTC(2026, 9, 1),
      fetcher,
    });
    assert.ok(calls.length > 0, 'the collector made no calls at all');
    assert.deepEqual(calls.filter((c) => !c.timed).map((c) => c.url), []);
  });

  test('a call that never answers fails its job instead of hanging it', async () => {
    // Honour the abort the way real fetch does, and otherwise never resolve.
    const hanging = (url, opts = {}) => new Promise((_, reject) => {
      opts.signal?.addEventListener('abort', () => reject(opts.signal.reason));
    });
    const started = Date.now();
    const out = await collectGmx({ now: Date.UTC(2026, 9, 1), fetcher: hanging });
    const took = Date.now() - started;
    assert.ok(took < 45_000, `took ${took}ms — longer than the poll's budget`);
    assert.ok(out.failed.length > 0, 'the stall should be reported, not swallowed');
  });
});

describe('the poll itself', () => {
  const src = readFileSync(new URL('../api/_panels/whales.js', import.meta.url), 'utf8');
  const poll = src.slice(src.indexOf("if (resource === 'poll')"), src.indexOf('const user = await userForToken'));

  test('holds each of its four jobs to a budget', () => {
    const budgeted = poll.match(/withBudget\(/g) ?? [];
    assert.equal(budgeted.length, 4, 'a job awaited outright can run the function into the 504');
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
});

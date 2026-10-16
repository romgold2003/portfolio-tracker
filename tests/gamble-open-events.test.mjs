/**
 * Bets on each topic's open Polymarket markets.
 *
 * The panel had shown nothing for weeks (October 2026): it read the latest 500
 * trades over $250k on all of Polymarket — nearly all football — and macro bets
 * rarely reach $250k (the biggest on the October Fed decision in a month was
 * $212k). Each topic now finds its open events by Polymarket's own tags and asks
 * for the bets in those; a market that has closed or ended drops out.
 *
 * Checked live: 249 Fed bets of $10k–50k and 17 of $50k–250k, all on the
 * October decision; Politics went from 0 to 783 once two events the feed
 * cannot answer for were set aside.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { whaleTrades, resetOpenEvents, selectTrades, countByTopic } from '../src/services/gamble.js';

const FUTURE = '2099-01-01T00:00:00Z';
const event = (id, title, markets) => ({ id, title, slug: `slug-${id}`, volume24hr: 100, markets });
const market = (conditionId, over = {}) => ({ conditionId, closed: false, endDate: FUTURE, ...over });

const EVENTS = {
  'fed-rates': [event('e-fed', 'Fed Decision in October?', [market('c-hold'), market('c-hike')])],
  economy: [
    event('e-fed', 'Fed Decision in October?', [market('c-hold'), market('c-hike')]),
    event('e-cpi', 'October Inflation US - Annual', [market('c-cpi')]),
  ],
  politics: [event('e-bad', 'Republican Presidential Nominee 2028', [market('c-bad')]),
    event('e-br', 'Brazil Presidential Election', [market('c-br')])],
  crypto: [
    event('e-btc', 'What price will Bitcoin hit in October?', [market('c-btc'), market('c-btc-old', { closed: true })]),
    event('e-clar', 'Clarity Act signed into law in 2026?', [market('c-clar')]),
  ],
};

const trade = (conditionId, usd, over = {}) => ({
  conditionId, title: `Market ${conditionId}`, eventSlug: `slug-${conditionId}`,
  proxyWallet: `0x${conditionId.padEnd(20, 'a')}`, side: 'BUY', outcome: 'Yes',
  size: usd * 2, price: 0.5, timestamp: 1_790_000_000, transactionHash: `0x${conditionId}${usd}`, ...over,
});
const TRADES = {
  'e-fed': [trade('c-hold', 160_000), trade('c-hike', 120_000)],
  'e-cpi': [trade('c-cpi', 115_000)],
  'e-br': [trade('c-br', 180_000)],
  'e-btc': [trade('c-btc', 130_000), trade('c-btc-old', 190_000)],
  'e-clar': [trade('c-clar', 300_000)],
};

let realFetch;
let asked;
beforeEach(() => {
  realFetch = globalThis.fetch;
  resetOpenEvents();
  asked = [];
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    asked.push(u);
    if (u.pathname === '/events') {
      return { ok: true, json: async () => EVENTS[u.searchParams.get('tag_slug')] ?? [] };
    }
    const ids = (u.searchParams.get('eventId') ?? '').split(',');
    // The feed answers 500 for some giant events, alone or in company.
    if (ids.includes('e-bad')) return { ok: false, status: 500, json: async () => ({}) };
    const floor = Number(u.searchParams.get('filterAmount'));
    const rows = ids.flatMap((id) => TRADES[id] ?? []).filter((t) => t.size * t.price >= floor);
    return { ok: true, json: async () => rows };
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('each topic, from its own open markets', () => {
  test('the October Fed bets are Fed bets, below $250k and all', async () => {
    const rows = await whaleTrades();
    const fed = selectTrades(rows, { band: 'k100', topic: 'fed' });
    assert.deepEqual(fed.map((t) => t.usd).sort(), [120_000, 160_000]);
  });

  test('an event two tags share belongs to the first topic: the Fed decision is not also economy', async () => {
    const counts = countByTopic(await whaleTrades(), 'k100');
    assert.equal(counts.get('econ'), 1, 'only the inflation bet');
  });

  test('crypto events naming a policy are policy; the rest are prices', async () => {
    const rows = await whaleTrades();
    assert.equal(selectTrades(rows, { band: 'mid', topic: 'policy' })[0].usd, 300_000);
    assert.deepEqual(selectTrades(rows, { band: 'k100', topic: 'coin' }).map((t) => t.usd), [130_000]);
  });

  test('a market that has closed is gone, though its event is still open', async () => {
    const rows = await whaleTrades();
    assert.ok(!rows.some((t) => t.conditionId === 'c-btc-old'));
  });

  test('an event the feed cannot answer for does not take its topic down with it', async () => {
    const rows = await whaleTrades();
    assert.deepEqual(selectTrades(rows, { band: 'all', topic: 'polit' }).map((t) => t.usd), [180_000]);
    asked.length = 0;
    await whaleTrades();
    assert.ok(!asked.some((u) => (u.searchParams.get('eventId') ?? '').includes('e-bad')), 'set aside after failing alone');
  });

  test('each bet links to its event on Polymarket', async () => {
    const [t] = selectTrades(await whaleTrades(), { band: 'all', topic: 'fed' });
    assert.ok(t.slug.startsWith('slug-c-'));
  });

  test('the open events are asked for every ten minutes, the bets every refresh', async () => {
    await whaleTrades();
    asked.length = 0;
    await whaleTrades();
    assert.ok(!asked.some((u) => u.pathname === '/events'));
    assert.ok(asked.some((u) => u.pathname === '/trades'));
  });
});

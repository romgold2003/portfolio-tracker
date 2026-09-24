/**
 * A bet on a market that has already been decided is not news.
 *
 * The trades feed says nothing about whether a market is still running, so a
 * $250,000 bet on "Will Bitcoin be above $84,000 on September 23?" sat in the
 * panel on the 24th, when the answer was already known and nobody could act on
 * it. The market list is asked about the trades in hand, in batches, and
 * anything decided is dropped.
 *
 * Only the settled verdict is remembered. A market that has paid out stays paid
 * out; one that is running now may settle in an hour, and remembering it as
 * running would leave it on screen for the rest of the session — which is the
 * very thing this exists to fix.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { whaleTrades, resetSettledMarkets } from '../src/services/gamble.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
beforeEach(() => resetSettledMarkets());

const trade = (conditionId, title, over = {}) => ({
  conditionId, title, proxyWallet: '0xaaaaaaaaaaaaaaaaaaaa', side: 'BUY', outcome: 'Yes',
  size: 600_000, price: 0.5, timestamp: 1_790_000_000, transactionHash: `0x${conditionId}`, ...over,
});

const FEED = [
  trade('running', 'Fed decision in September: 25 bps cut?'),
  trade('decided', 'Will Bitcoin be above $84,000 on September 23?'),
  trade('expired', 'Will Norway win on 2026-09-24?'),
];

/** Stands in for both endpoints, and counts what was asked of each. */
function stubFeed({ markets, marketsFail = false } = {}) {
  const calls = { trades: 0, markets: 0 };
  globalThis.fetch = async (url) => {
    if (String(url).includes('data-api')) {
      calls.trades += 1;
      return { ok: true, json: async () => FEED };
    }
    calls.markets += 1;
    if (marketsFail) throw new Error('markets endpoint down');
    return { ok: true, json: async () => markets };
  };
  return calls;
}

const OPEN_AND_DECIDED = [
  { conditionId: 'running', closed: false, endDate: '2027-01-01T00:00:00Z' },
  { conditionId: 'decided', closed: true, endDate: '2026-09-23T00:00:00Z' },
  { conditionId: 'expired', closed: false, endDate: '2020-01-01T00:00:00Z' },
];

describe('dropping what has already been decided', () => {
  test('a settled market goes, and a running one stays', async () => {
    stubFeed({ markets: OPEN_AND_DECIDED });
    const rows = await whaleTrades();
    assert.deepEqual(rows.map((t) => t.conditionId), ['running']);
  });

  test("the broker's own word for it is enough", async () => {
    stubFeed({ markets: [{ conditionId: 'decided', closed: true }] });
    const rows = await whaleTrades();
    assert.ok(!rows.some((t) => t.conditionId === 'decided'));
  });

  test('so is an end date already past, for the window after the event', async () => {
    // A market stays open a short while after the thing it describes happens.
    stubFeed({ markets: [{ conditionId: 'expired', closed: false, endDate: '2020-01-01T00:00:00Z' }] });
    const rows = await whaleTrades();
    assert.ok(!rows.some((t) => t.conditionId === 'expired'));
  });

  test('an archived market goes too', async () => {
    stubFeed({ markets: [{ conditionId: 'decided', archived: true }] });
    assert.ok(!(await whaleTrades()).some((t) => t.conditionId === 'decided'));
  });
});

describe('when the lookup cannot answer', () => {
  test('the trades stay on screen rather than the panel going blank', async () => {
    stubFeed({ marketsFail: true });
    const rows = await whaleTrades();
    assert.equal(rows.length, 3, 'a second opinion that failed must not hide real trades');
  });

  test('a market it says nothing about is treated as still running', async () => {
    stubFeed({ markets: [] });
    assert.equal((await whaleTrades()).length, 3);
  });

  test('and rubbish from it is ignored rather than trusted', async () => {
    stubFeed({ markets: { not: 'an array' } });
    assert.equal((await whaleTrades()).length, 3);
  });
});

describe('what is worth remembering', () => {
  test('a settled market is never asked about twice', async () => {
    const calls = stubFeed({ markets: OPEN_AND_DECIDED });
    await whaleTrades();
    const first = calls.markets;
    await whaleTrades();
    // The two that settled are known; only the runner is worth asking about,
    // and it still fits in one batch.
    assert.ok(calls.markets > first, 'the running market is checked again');
    assert.equal(calls.markets - first, 1, 'but the settled ones are not');
  });

  test('a market that settles later does disappear', async () => {
    stubFeed({ markets: [{ conditionId: 'running', closed: false, endDate: '2027-01-01T00:00:00Z' }] });
    assert.ok((await whaleTrades()).some((t) => t.conditionId === 'running'));
    // An hour passes and it resolves.
    stubFeed({ markets: [{ conditionId: 'running', closed: true }] });
    assert.ok(!(await whaleTrades()).some((t) => t.conditionId === 'running'),
      'a market remembered as running would have stayed all session');
  });
});

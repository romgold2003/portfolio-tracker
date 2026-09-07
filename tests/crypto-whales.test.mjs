/**
 * The crypto whale tracker.
 *
 * Three things here are easy to get quietly wrong and each has a section:
 * the coverage join, which decides whether the picker tells the truth about
 * what can be watched; the store, which is the only reason the panel has a
 * history rather than an hour; and the dedup, because a bridged stablecoin
 * reported once per network would double the single number the panel is read
 * for.
 *
 * The provider's own feed needs a key and is not reachable from a test, so the
 * transport is faked and the *parsing* is what is checked — which is where the
 * bugs would be anyway.
 */
import { test, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';

import { useDriver } from '../api/_lib/db.js';
import { sqliteDriver } from './support/sqlite.mjs';
import {
  normaliseTransfer, fetchCoverage, fetchTransfers, resetCoverageCache,
} from '../api/_lib/whalealert.js';
import { topCoins, watchContracts, resetTopCoinsCache, resetPriceCache } from '../api/_lib/topcoins.js';
import {
  priceFor, normalise as normaliseChain,
  FLOOR_USD as CHAIN_FLOOR, DISPLAY_FLOOR_USD as DISPLAY_FLOOR,
} from '../api/_lib/chainfeeds.js';
import * as store from '../api/_lib/whalestore.js';
import {
  BANDS, bandDef, selectTransfers, directionOf, partyName, money, tokens,
  explorerTx, explorerAddress, chainLabel,
} from '../src/services/cryptoWhales.js';

/** A fetch that answers with one canned body, and counts how often it is asked. */
function stubFetch(bodies) {
  const queue = [...bodies];
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    const body = queue.length > 1 ? queue.shift() : queue[0];
    if (body instanceof Error) throw body;
    return {
      ok: body.status ? body.status < 400 : true,
      status: body.status ?? 200,
      json: async () => body.json,
    };
  };
  fn.calls = calls;
  return fn;
}

const COVERAGE = [
  { name: 'ethereum', symbols: ['ETH', 'USDT', 'USDC', 'LINK', 'SHIB'] },
  { name: 'bitcoin', symbols: ['BTC', 'USDT'] },
  { name: 'solana', symbols: ['SOL', 'USDT', 'USDC'] },
  { name: 'ripple', symbols: ['XRP'] },
  { name: 'tron', symbols: ['TRX', 'USDT'] },
];

beforeEach(() => {
  useDriver(sqliteDriver());
  store.resetTableCache();
  resetCoverageCache();
  resetTopCoinsCache();
  resetPriceCache();
});

describe('what the provider says it can see', () => {
  test('a symbol maps to every chain it appears on', async () => {
    const coverage = await fetchCoverage({ fetcher: stubFetch([{ json: COVERAGE }]) });
    assert.deepEqual(coverage.bySymbol.get('USDT'), ['ethereum', 'bitcoin', 'solana', 'tron']);
    assert.deepEqual(coverage.bySymbol.get('BTC'), ['bitcoin']);
    assert.equal(coverage.bySymbol.get('AVAX'), undefined);
    assert.deepEqual(coverage.chains, ['bitcoin', 'ethereum', 'ripple', 'solana', 'tron']);
  });

  test('it is asked once and then remembered', async () => {
    const fetcher = stubFetch([{ json: COVERAGE }]);
    await fetchCoverage({ fetcher });
    await fetchCoverage({ fetcher });
    assert.equal(fetcher.calls.length, 1);
  });
});

describe('the top fifty, joined to the chains that can be read', () => {
  const markets = [
    { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', image: 'b.png', market_cap_rank: 1 },
    { id: 'tether', symbol: 'usdt', name: 'Tether', image: 'u.png', market_cap_rank: 3 },
    { id: 'avalanche-2', symbol: 'avax', name: 'Avalanche', image: 'a.png', market_cap_rank: 12 },
    { id: 'chainlink', symbol: 'link', name: 'Chainlink', image: 'l.png', market_cap_rank: 15 },
  ];

  /** CoinGecko's own contract map — the thing that replaces a typed table. */
  const platforms = [
    { id: 'bitcoin', platforms: {} },
    {
      id: 'tether',
      platforms: {
        ethereum: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        tron: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        'polygon-pos': '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
        solana: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      },
    },
    { id: 'avalanche-2', platforms: {} },
    { id: 'chainlink', platforms: { ethereum: '0x514910771af9ca656af840dff83e8264ecf986ca' } },
  ];

  const feed = (extra = []) => stubFetch([
    { json: markets }, { json: platforms }, ...extra,
  ]);

  test('a coin is matched to a chain by its contract, not by a typed table', async () => {
    const { coins } = await topCoins({ fetcher: feed() });
    const bySymbol = Object.fromEntries(coins.map((c) => [c.symbol, c]));

    // Three of Tether's four networks have a reader here; Solana does not, and
    // is correctly not claimed.
    assert.deepEqual(bySymbol.USDT.readers.map((r) => r.chain).sort(),
      ['ethereum', 'polygon', 'tron']);
    assert.equal(bySymbol.USDT.support, 'multi');
    assert.equal(
      bySymbol.USDT.readers.find((r) => r.chain === 'tron').contract,
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    );
  });

  test('a native coin is matched to its own chain, contract or not', async () => {
    const { coins } = await topCoins({ fetcher: feed() });
    const btc = coins.find((c) => c.symbol === 'BTC');
    assert.deepEqual(btc.readers.map((r) => r.chain), ['bitcoin']);
    assert.equal(btc.readers[0].contract, null);
    assert.equal(btc.readers[0].native, true);
    // Bitcoin is sampled rather than swept, and the word for that is partial.
    assert.equal(btc.support, 'partial');
  });

  test('a top-fifty coin with no readable chain is kept and marked, not dropped', async () => {
    const { coins, watchable } = await topCoins({ fetcher: feed() });
    const avax = coins.find((c) => c.symbol === 'AVAX');
    // Showing it greyed is information. Omitting it looks like a bug.
    assert.ok(avax, 'AVAX was dropped from the list');
    assert.equal(avax.support, 'none');
    assert.deepEqual(avax.chains, []);
    assert.equal(avax.rank, 12);
    assert.equal(watchable, 3);
  });

  test('a chain read in full is single, not partial', async () => {
    const { coins } = await topCoins({ fetcher: feed() });
    assert.equal(coins.find((c) => c.symbol === 'LINK').support, 'single');
  });

  test('an unreachable contract map is unknown, not unsupported', async () => {
    // Saying "cannot be watched" because a second request failed is a
    // confident claim built on a missing answer. Native coins still match.
    const fetcher = async (url) => {
      if (String(url).includes('coins/list')) throw new Error('platform map is down');
      return { ok: true, status: 200, json: async () => markets };
    };
    const { coins } = await topCoins({ fetcher });
    assert.equal(coins.find((c) => c.symbol === 'USDT').support, 'unknown');
    // BTC needs no contract, so it is still readable and still says so.
    assert.equal(coins.find((c) => c.symbol === 'BTC').support, 'partial');
  });

  test('the sweep list is the contracts, taken from that same map', async () => {
    const contracts = await watchContracts({ fetcher: feed() });
    assert.ok(contracts.ethereum.includes('0xdac17f958d2ee523a2206206994597c13d831ec7'));
    assert.ok(contracts.tron.includes('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'));
    // No address appears twice, or the same feed would be swept twice.
    for (const list of Object.values(contracts)) {
      assert.equal(new Set(list).size, list.length);
    }
  });

  test('every chain reports whether it is swept or only sampled', async () => {
    const { chains } = await topCoins({ fetcher: feed() });
    assert.ok(chains.length >= 5);
    for (const c of chains) {
      assert.equal(typeof c.complete, 'boolean');
      // A sampled chain must carry the sentence that says so.
      if (!c.complete) assert.ok(c.note, `${c.id} is sampled but says nothing`);
    }
  });
});

describe('valuing a transfer, which is where the garbage gets in', () => {
  test('an unlisted token is dropped rather than valued', () => {
    // Anyone can deploy a contract and have an indexer quote a price for it.
    // At a $20M floor that garbage outranks every real transfer.
    const prices = new Map([['USDC', 1]]);
    assert.equal(priceFor('AIPF', prices, 405_000_000), null);
    assert.equal(priceFor('USDC', prices, 0.9999), 1);
  });

  test('two quotes that disagree wildly means neither is trusted', () => {
    const prices = new Map([['LINK', 20]]);
    assert.equal(priceFor('LINK', prices, 21), 20);
    assert.equal(priceFor('LINK', prices, 400), null);
    assert.equal(priceFor('LINK', prices, 0.01), null);
  });

  test('a wrapper is priced as the asset it wraps', () => {
    // WETH is redeemable one-for-one by the contract; it is not a guess. It is
    // also the largest single source of big transfers on Ethereum, and was
    // invisible while it went unpriced.
    const prices = new Map([['ETH', 2500], ['BTC', 80000]]);
    assert.equal(priceFor('WETH', prices, 2510), 2500);
    assert.equal(priceFor('WBTC', prices, 79900), 80000);
  });

  test('nothing is one transfer of twenty-five billion dollars', () => {
    // The first live scan produced $27,870,034,145,600,000,000 from a token
    // whose exchange rate was fiction.
    assert.equal(normaliseChain({
      chain: 'ethereum', symbol: 'AIPF', amount: 1, usd: 2.787e19,
      hash: '0xabc', at: 1_780_000_000,
    }), null);
    assert.ok(normaliseChain({
      chain: 'ethereum', symbol: 'USDC', amount: 1, usd: 5e8,
      hash: '0xabc', at: 1_780_000_000,
    }));
  });

  test('what is recorded and what is shown are two different floors', () => {
    // $400k is not a headline, and it is exactly what a position gets built out
    // of — so it is recorded even though the transfer list will not show it.
    const small = normaliseChain({
      chain: 'ethereum', symbol: 'USDC', amount: 1, usd: 400_000,
      hash: '0xabc', at: 1_780_000_000,
    });
    assert.ok(small, 'a $400k transfer was thrown away and cannot be added up later');
    assert.ok(CHAIN_FLOOR < DISPLAY_FLOOR, 'collection must reach below display');
    // Under the collection floor, still nothing.
    assert.equal(normaliseChain({
      chain: 'ethereum', symbol: 'USDC', amount: 1, usd: 249_999,
      hash: '0xabc', at: 1_780_000_000,
    }), null);
  });

  test('a mint, a burn and a contract call are not plain transfers', () => {
    const base = { chain: 'ethereum', symbol: 'USDC', amount: 1, usd: 5e7, hash: '0xa', at: 1e9 };
    const zero = '0x0000000000000000000000000000000000000000';
    assert.equal(normaliseChain({ ...base, from: { address: zero } }).kind, 'mint');
    assert.equal(normaliseChain({ ...base, to: { address: zero } }).kind, 'burn');
    // One atomic transaction moving money between two contracts is not a whale
    // deciding something, and the first live scan was six legs of exactly that.
    assert.equal(normaliseChain({ ...base, to: { address: '0xb', contract: true } }).kind, 'contract');
    assert.equal(normaliseChain({ ...base, from: { address: '0xb' }, to: { address: '0xc' } }).kind,
      'transfer');
  });

  test('one movement is one id, whatever size each leg was', () => {
    // A swap emits the same asset in and out of one transaction at slightly
    // different sizes. Both kept would show one event twice.
    const leg = (usd) => normaliseChain({
      chain: 'ethereum', symbol: 'WBTC', amount: 1, usd, hash: '0xsame', at: 1e9,
    });
    assert.equal(leg(4.396e8).id, leg(4.39e8).id);
    // Different assets in one transaction really are two movements.
    assert.notEqual(leg(5e7).id, normaliseChain({
      chain: 'ethereum', symbol: 'USDC', amount: 1, usd: 5e7, hash: '0xsame', at: 1e9,
    }).id);
  });
});


describe('reading one transfer', () => {
  const raw = {
    blockchain: 'ethereum',
    symbol: 'usdt',
    id: '997',
    transaction_type: 'transfer',
    hash: '0xabc',
    from: { address: '0xaaa', owner: 'binance', owner_type: 'exchange' },
    to: { address: '0xbbb', owner: '', owner_type: 'unknown' },
    timestamp: 1_780_000_000,
    amount: 42_000_000,
    amount_usd: 42_000_000,
    transaction_count: 1,
  };

  test('the fields come across, upper-cased where they are compared', () => {
    const t = normaliseTransfer(raw);
    assert.equal(t.symbol, 'USDT');
    assert.equal(t.blockchain, 'ethereum');
    assert.equal(t.usd, 42_000_000);
    assert.equal(t.from.owner, 'binance');
    assert.equal(t.from.ownerType, 'exchange');
  });

  test('an owner the provider does not know is null, never a guess', () => {
    const t = normaliseTransfer(raw);
    assert.equal(t.to.owner, null);
    assert.equal(t.to.ownerType, null);
    assert.equal(t.to.address, '0xbbb');
  });

  test('the id separates two transfers inside one transaction', () => {
    const a = normaliseTransfer({ ...raw, id: '1' });
    const b = normaliseTransfer({ ...raw, id: '2' });
    assert.notEqual(a.id, b.id);
    assert.ok(a.id.startsWith('ethereum:0xabc:'));
  });

  test('a row without a value, a hash or a time is not a row', () => {
    assert.equal(normaliseTransfer({ ...raw, amount_usd: 0 }), null);
    assert.equal(normaliseTransfer({ ...raw, hash: '' }), null);
    assert.equal(normaliseTransfer({ ...raw, timestamp: null }), null);
    assert.equal(normaliseTransfer(null), null);
  });

  test('a mint is carried through as a mint', () => {
    assert.equal(normaliseTransfer({ ...raw, transaction_type: 'mint' }).kind, 'mint');
  });
});

describe('asking the provider', () => {
  const page = (n, cursor) => ({
    json: {
      result: 'success',
      cursor,
      transactions: Array.from({ length: n }, (_, i) => ({
        blockchain: 'ethereum', symbol: 'eth', id: `${cursor ?? 'z'}${i}`,
        transaction_type: 'transfer', hash: `0x${i}`,
        from: { address: '0xa' }, to: { address: '0xb' },
        timestamp: 1_780_000_000 + i, amount: 10, amount_usd: 25_000_000,
      })),
    },
  });

  test('it walks the cursor rather than widening the window', async () => {
    const fetcher = stubFetch([page(2, 'next'), page(1, null)]);
    const rows = await fetchTransfers({ start: 1, key: 'k', fetcher });
    assert.equal(rows.length, 3);
    assert.ok(fetcher.calls[1].includes('cursor=next'));
  });

  test('no key is a stated failure, not an empty list', async () => {
    await assert.rejects(() => fetchTransfers({ start: 1, key: '', fetcher: stubFetch([page(0)]) }),
      /WHALE_ALERT_KEY/);
  });

  test('a rate limit keeps what it already collected', async () => {
    const fetcher = stubFetch([page(2, 'next'), { status: 429, json: {} }]);
    const rows = await fetchTransfers({ start: 1, key: 'k', fetcher });
    assert.equal(rows.length, 2);
  });

  test('a refusal dressed as a 200 still throws', async () => {
    const fetcher = stubFetch([{ json: { result: 'error', message: 'window too wide' } }]);
    await assert.rejects(() => fetchTransfers({ start: 1, key: 'k', fetcher }), /window too wide/);
  });
});

describe('the store, which is why there is any history at all', () => {
  const transfer = (over = {}) => ({
    id: 'ethereum:0xabc:1', at: 1_780_000_000, blockchain: 'ethereum', symbol: 'USDT',
    kind: 'transfer', amount: 42_000_000, usd: 42_000_000, hash: '0xabc',
    from: { address: '0xa', owner: 'binance', ownerType: 'exchange' },
    to: { address: '0xb', owner: null, ownerType: null },
    parts: 1, ...over,
  });

  test('a transfer written twice is held once', async () => {
    assert.equal(await store.record([transfer()]), 1);
    assert.equal(await store.record([transfer()]), 0);
    assert.equal((await store.read()).length, 1);
  });

  test('what goes in comes back out as numbers, not text', async () => {
    await store.record([transfer()]);
    const [row] = await store.read();
    assert.equal(row.usd, 42_000_000);
    assert.equal(row.amount, 42_000_000);
    assert.equal(row.at, 1_780_000_000);
    assert.equal(row.from.owner, 'binance');
    assert.equal(row.to.owner, null);
  });

  test('an amount far past an integer column survives the round trip', async () => {
    // 400 billion SHIB is not a ten-digit number, which is why these are text.
    await store.record([transfer({ id: 'x', symbol: 'SHIB', amount: 412_000_000_000 })]);
    const [row] = await store.read({ symbol: 'SHIB' });
    assert.equal(row.amount, 412_000_000_000);
  });

  test('the band filter is arithmetic, not string comparison', async () => {
    // '9000000' > '20000000' as text. Applying the floor in SQL against a text
    // column would rank nine million above twenty.
    await store.record([
      transfer({ id: 'a', usd: 9_000_000 }),
      transfer({ id: 'b', usd: 25_000_000 }),
      transfer({ id: 'c', usd: 120_000_000 }),
    ]);
    const big = await store.read({ minUsd: 20_000_000, maxUsd: 100_000_000 });
    assert.deepEqual(big.map((r) => r.usd), [25_000_000]);
  });

  test('it comes back newest first', async () => {
    await store.record([
      transfer({ id: 'a', at: 1_780_000_100 }),
      transfer({ id: 'b', at: 1_780_000_300 }),
      transfer({ id: 'c', at: 1_780_000_200 }),
    ]);
    assert.deepEqual((await store.read()).map((r) => r.at),
      [1_780_000_300, 1_780_000_200, 1_780_000_100]);
  });

  test('the newest held is what the next poll asks from', async () => {
    assert.equal(await store.latestAt(), null);
    await store.record([transfer({ id: 'a', at: 100 }), transfer({ id: 'b', at: 900 })]);
    assert.equal(await store.latestAt(), 900);
  });

  test('what has aged out is dropped', async () => {
    const now = 1_780_000_000_000;
    await store.record([
      transfer({ id: 'old', at: Math.floor((now - store.RETAIN_MS - 1000) / 1000) }),
      transfer({ id: 'new', at: Math.floor(now / 1000) }),
    ]);
    await store.prune({ now });
    assert.deepEqual((await store.read()).map((r) => r.id), ['new']);
  });

  test('counts are per symbol, above the floor', async () => {
    await store.record([
      transfer({ id: 'a', symbol: 'BTC', usd: 30_000_000 }),
      transfer({ id: 'b', symbol: 'BTC', usd: 60_000_000 }),
      transfer({ id: 'c', symbol: 'ETH', usd: 25_000_000 }),
      transfer({ id: 'd', symbol: 'ETH', usd: 1_000_000 }),
    ]);
    const counts = await store.countsBySymbol({ minUsd: 20_000_000 });
    assert.equal(counts.get('BTC'), 2);
    assert.equal(counts.get('ETH'), 1);
  });
});

describe('which way the money went', () => {
  const t = (from, to, kind = 'transfer') => ({ kind, from, to });
  const ex = { ownerType: 'exchange', owner: 'binance' };
  const wal = { ownerType: 'wallet', owner: null };
  const none = { ownerType: null, owner: null };

  test('both ends known gives the direction', () => {
    assert.equal(directionOf(t(ex, wal)).label, 'Exchange → Wallet');
    assert.equal(directionOf(t(wal, ex)).label, 'Wallet → Exchange');
    assert.equal(directionOf(t(ex, ex)).label, 'Exchange → Exchange');
  });

  test('one end known says only what is known', () => {
    assert.equal(directionOf(t(ex, none)).label, 'Exchange → Unknown');
    assert.equal(directionOf(t(none, ex)).label, 'Unknown → Exchange');
  });

  test('neither end known is wallet to wallet, which is most of them', () => {
    assert.equal(directionOf(t(none, none)).label, 'Wallet → Wallet');
  });

  test('a mint is not a direction', () => {
    // It has no meaningful sender, so calling it Exchange → Wallet would be
    // wrong twice over.
    assert.equal(directionOf(t(none, ex, 'mint')).label, 'Mint');
    assert.equal(directionOf(t(ex, none, 'burn')).label, 'Burn');
  });

  test('a named entity is used, an unnamed one falls back to the address', () => {
    assert.equal(partyName({ owner: 'binance', address: '0xaaa' }), 'Binance');
    assert.equal(partyName({ owner: null, address: '0x1234567890abcdef1234' }), '0x1234…1234');
    assert.equal(partyName({ owner: null, address: null }), 'Unknown');
  });
});

describe('choosing what to show', () => {
  const row = (over) => ({
    id: Math.random().toString(), at: 1_780_000_000, blockchain: 'ethereum',
    symbol: 'USDT', kind: 'transfer', amount: 1, usd: 30_000_000,
    from: {}, to: {}, parts: 1, ...over,
  });

  test('the bands do not overlap and together cover everything above the floor', () => {
    const bands = BANDS.filter((b) => b.id !== 'all');
    // Set from the record twice. First they were three empty boxes; then the
    // lowest held nine of fourteen positions and crowded out everything above.
    assert.deepEqual(bands.map((b) => b.min), [25e6, 100e6, 250e6]);
    assert.deepEqual(bands.map((b) => b.max), [100e6, 250e6, Infinity]);
    // By name, not by index: BANDS[3] was "all" until a fourth band was added
    // and silently became "$100M+".
    assert.equal(bandDef('nope').id, 'all');
    assert.equal(bandDef('all').min, 25e6);
  });

  test('a band keeps its own and nothing else', () => {
    const rows = [row({ usd: 60e6 }), row({ usd: 150e6 }), row({ usd: 400e6 })];
    assert.equal(selectTransfers(rows, { band: 'big' }).length, 1);
    assert.equal(selectTransfers(rows, { band: 'huge' }).length, 1);
    assert.equal(selectTransfers(rows, { band: 'mega' }).length, 1);
    assert.equal(selectTransfers(rows, { band: 'all' }).length, 3);
    // Under the lowest band it is in no band at all, not quietly in the first.
    assert.equal(selectTransfers([row({ usd: 20e6 })], { band: 'all' }).length, 0);
  });

  test('one bridged movement seen on two chains is one row, noting both', () => {
    const rows = [
      row({ blockchain: 'ethereum', usd: 80_000_000, at: 1_780_000_000 }),
      row({ blockchain: 'tron', usd: 80_000_000, at: 1_780_000_020 }),
    ];
    const out = selectTransfers(rows, { band: 'all' });
    assert.equal(out.length, 1, 'the same movement was counted twice');
    // The first seen is the row that is kept; the other network is recorded on
    // it, so the card can say "Ethereum + Tron" rather than losing the crossing.
    assert.equal(out[0].blockchain, 'ethereum');
    assert.deepEqual(out[0].alsoOn ?? [], ['tron']);
  });

  test('two different whales moving the same amount on one chain stay two rows', () => {
    const rows = [
      row({ blockchain: 'ethereum', usd: 80_000_000, at: 1_780_000_000 }),
      row({ blockchain: 'ethereum', usd: 80_000_000, at: 1_780_009_000 }),
    ];
    assert.equal(selectTransfers(rows, { band: 'all' }).length, 2);
  });

  test('newest first', () => {
    const rows = [row({ at: 100 }), row({ at: 900 }), row({ at: 500 })];
    assert.deepEqual(selectTransfers(rows, { band: 'all' }).map((r) => r.at), [900, 500, 100]);
  });

  test('nothing at all is an empty list, not a throw', () => {
    assert.deepEqual(selectTransfers(null, { band: 'all' }), []);
    assert.deepEqual(selectTransfers([], { band: 'all' }), []);
  });
});

describe('the links, which are the proof', () => {
  test('every chain the provider covers has an explorer', async () => {
    // A row nobody can open and check independently is a claim, not evidence.
    const live = await fetchCoverage({ fetcher: stubFetch([{ json: COVERAGE }]) });
    for (const chain of live.chains) {
      assert.ok(explorerTx(chain, '0xabc'), `no transaction explorer for ${chain}`);
      assert.ok(explorerAddress(chain, '0xabc'), `no address explorer for ${chain}`);
    }
  });

  test('the hash is escaped into the URL', () => {
    assert.equal(explorerTx('ethereum', '0xab/../c'), 'https://etherscan.io/tx/0xab%2F..%2Fc');
    assert.equal(explorerTx('nosuchchain', '0xabc'), null);
  });

  test('a chain reads as its name, not its slug', () => {
    assert.equal(chainLabel('bitcoin_cash'), 'Bitcoin Cash');
    assert.equal(chainLabel('ripple'), 'XRP Ledger');
    assert.equal(chainLabel('newchain'), 'Newchain');
  });
});

describe('the numbers on screen', () => {
  test('dollars read at the scale that matters', () => {
    assert.equal(money(24_500_000), '$24.5M');
    assert.equal(money(1_240_000_000), '$1.24B');
  });

  test('token counts keep fewer digits the larger they get', () => {
    assert.equal(tokens(1234.567, 'ETH'), '1,234.6 ETH');
    assert.equal(tokens(9.4127, 'BTC'), '9.41 BTC');
    assert.equal(tokens(412_000_000_000, 'SHIB'), '412,000,000,000 SHIB');
    assert.equal(tokens(null, 'BTC'), '');
  });
});

describe('the zero address is not a counterparty', () => {
  test('a mint has no sender, however the indexer labels it', () => {
    // Blockscout calls it "Null: 0x000...000", which the row rendered in bold
    // as a recognised entity — so a mint read as though a party called Null had
    // sent sixty-six million dollars. Nobody sent it. It was created.
    const row = normaliseChain({
      chain: 'ethereum', symbol: 'USYC', amount: 58e6, usd: 6.6e7,
      hash: '0xd346', at: 1_788_506_231,
      from: { address: '0x0000000000000000000000000000000000000000', owner: 'Null: 0x000...000', ownerType: 'entity' },
      to: { address: '0x231d', owner: 'CrossChainTeller', ownerType: 'contract', contract: true },
    });
    assert.equal(row.kind, 'mint');
    assert.equal(row.from.owner, null);
    assert.equal(row.from.ownerType, null);
    // The real counterparty keeps its name.
    assert.equal(row.to.owner, 'CrossChainTeller');
  });
});

describe('per wallet, not per transfer', () => {
  const at = Math.floor(Date.now() / 1000);
  const move = (id, from, to, usd, over = {}) => ({
    id, at: at - 3600, blockchain: 'ethereum', symbol: 'ETH', kind: 'transfer',
    amount: 1, usd, hash: id,
    from: { address: from, owner: null, ownerType: null },
    to: { address: to, owner: null, ownerType: null },
    parts: 1, ...over,
  });

  test('a wallet that only receives is accumulating', async () => {
    for (let i = 0; i < 10; i++) {
      await store.record([move(`t${i}`, `0xseller${i}`, '0xWHALE', 3_000_000)]);
    }
    const [top] = await store.byAddress({ minNetUsd: 1_000_000, kinds: ['transfer'] });
    assert.equal(top.address, '0xWHALE');
    assert.equal(top.netUsd, 30_000_000);
    assert.equal(top.transfers, 10);
    assert.equal(top.oneWay, true, 'it never sent anything back');
  });

  test('a pass-through address nets out and stops dominating the list', async () => {
    // Money in and straight back out is a router, not a whale. This is the
    // behaviour that swamps a raw feed and that netting is here to remove.
    await store.record([
      move('a', '0xsrc', '0xPIPE', 50_000_000),
      move('b', '0xPIPE', '0xdst', 50_000_000),
    ]);
    const wallets = await store.byAddress({ minNetUsd: 1_000_000, kinds: ['transfer'] });
    assert.ok(!wallets.some((w) => w.address === '0xPIPE'),
      'a pass-through address ranked as a whale');
  });

  test('sending more than it received reads as distribution', async () => {
    await store.record([
      move('c', '0xsrc', '0xSELLER', 5_000_000),
      move('d', '0xSELLER', '0xexch', 40_000_000),
    ]);
    const seller = (await store.byAddress({ minNetUsd: 1_000_000, kinds: ['transfer'] }))
      .find((w) => w.address === '0xSELLER');
    assert.ok(seller.netUsd < 0, 'net was not negative');
    assert.equal(seller.netUsd, -35_000_000);
  });

  test('mints and contract legs are not a wallet taking a position', async () => {
    await store.record([
      move('e', '0xsrc', '0xMINTY', 80_000_000, { kind: 'mint' }),
      move('f', '0xsrc', '0xCONTRACTY', 90_000_000, { kind: 'contract' }),
    ]);
    const wallets = await store.byAddress({ minNetUsd: 1_000_000, kinds: ['transfer'] });
    assert.ok(!wallets.some((w) => ['0xMINTY', '0xCONTRACTY'].includes(w.address)));
  });

  test('the burn hole never heads the ranking', async () => {
    await store.record([move('g', '0xsrc', '0x0000000000000000000000000000000000000000', 9e8)]);
    const wallets = await store.byAddress({ minNetUsd: 1_000_000, kinds: ['transfer'] });
    assert.ok(!wallets.some((w) => /^0x0{40}$/.test(w.address)));
  });

  test('what it holds, and when it was last active', async () => {
    await store.record([move('h', '0xsrc', '0xMIX', 8_000_000, { symbol: 'WBTC' })]);
    const mix = (await store.byAddress({ minNetUsd: 1_000_000, kinds: ['transfer'] }))
      .find((w) => w.address === '0xMIX');
    assert.deepEqual(mix.symbols.map((s) => s.symbol), ['WBTC']);
    assert.deepEqual(mix.chains, ['ethereum']);
    assert.ok(mix.lastAt >= mix.firstAt);
  });

  test('a window that ends before the rows returns nothing, not everything', async () => {
    await store.record([move('i', '0xsrc', '0xOLD', 40_000_000, { at: at - 40 * 86400 })]);
    const recent = await store.byAddress({ sinceDays: 1, minNetUsd: 1_000_000, kinds: ['transfer'] });
    assert.ok(!recent.some((w) => w.address === '0xOLD'));
  });
});

describe('money reads at the scale of the number', () => {
  test('it does not force everything into millions', () => {
    // The first real wallet list came back with six rows reading "$0.0M".
    // Nothing was wrong with the arithmetic — the formatter had one unit.
    assert.equal(money(1_240_000_000), '$1.24B');
    assert.equal(money(84_300_000), '$84.3M');
    assert.equal(money(450_000), '$450k');
    assert.equal(money(12_000), '$12k');
    assert.equal(money(640), '$640');
  });

  test('a negative keeps its sign in front of the dollars', () => {
    assert.equal(money(-4_049_468), '-$4.0M');
    assert.equal(money(-12_000), '-$12k');
  });

  test('zero is zero, not $0.0M', () => {
    assert.equal(money(0), '$0');
    assert.equal(money(null), '$0');
  });
});

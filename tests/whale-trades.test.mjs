/**
 * The new whale panel: spot and leveraged buys and sells of the top-fifty coins.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  filterRows, summarise, countByBand, groupFills, hyperliquidMarkets, walletLink,
} from '../src/services/whaleTrades.js';
import { tradesOf, withoutBots, tokensFor } from '../api/_lib/dexspot.js';

const row = (symbol, side, usd, at = 1000, extra = {}) => ({
  id: `${symbol}${side}${usd}${at}${extra.address ?? ""}`, symbol, side, usd, at, ...extra,
});

describe('filters', () => {
  const rows = [
    row('BTC', 'buy', 3_000_000), row('BTC', 'sell', 12_000_000), row('ETH', 'buy', 30_000_000),
    row('ETH', 'sell', 7_000_000), row('SOL', 'buy', 1_500_000),
  ];

  test('spot bands are $2M–5M, $10M–25M and $25M+, half-open', () => {
    assert.equal(filterRows(rows, { band: 'b1' }).length, 1);
    assert.equal(filterRows(rows, { band: 'b2' }).length, 1);
    assert.equal(filterRows(rows, { band: 'b3' }).length, 1);
    assert.equal(filterRows(rows, { band: 'all' }).length, 4, 'under $2M is never shown');
  });

  test('$5M–10M sits between two bands: in All, in none of the three', () => {
    const gap = filterRows(rows, { band: 'all' }).filter((r) => r.usd === 7_000_000);
    assert.equal(gap.length, 1);
    for (const band of ['b1', 'b2', 'b3']) {
      assert.equal(filterRows(rows, { band }).some((r) => r.usd === 7_000_000), false, band);
    }
  });

  test('leveraged keeps $10M–20M, $25M–40M and $40M+', async () => {
    const { filterLeveraged } = await import('../src/services/whaleTrades.js');
    const lev = [
      { symbol: 'BTC', side: 'long', usd: 12e6, at: 1 }, { symbol: 'BTC', side: 'short', usd: 30e6, at: 1 },
      { symbol: 'ETH', side: 'long', usd: 50e6, at: 1 }, { symbol: 'ETH', side: 'long', usd: 22e6, at: 1 },
      { symbol: 'SOL', side: 'long', usd: 8e6, at: 1 },
    ];
    assert.deepEqual(['b1', 'b2', 'b3', 'all'].map((band) => filterLeveraged(lev, { band }).length), [1, 1, 1, 4]);
    assert.equal(filterLeveraged(lev, { band: 'all' }).some((r) => r.usd === 8e6), false, 'under $10M is never shown');
  });

  test('buys and sells are filtered and summed apart', () => {
    assert.deepEqual(filterRows(rows, { side: 'buy' }).map((r) => r.side), ['buy', 'buy']);
    assert.deepEqual(filterRows(rows, { side: 'sell' }).map((r) => r.side), ['sell', 'sell']);
    const s = summarise(filterRows(rows));
    assert.equal(s.buyUsd, 33_000_000);
    assert.equal(s.sellUsd, 19_000_000);
    assert.equal(s.net, 14_000_000);
  });

  test('one coin, and the counts each band button shows', () => {
    assert.deepEqual(filterRows(rows, { coin: 'ETH' }).map((r) => r.symbol), ['ETH', 'ETH']);
    assert.equal(countByBand(rows, { coin: 'BTC' }).get('all'), 2);
  });
});

describe('Hyperliquid orders', () => {
  test('fills of one order become one row, with the taker as the whale', () => {
    const fills = [
      { coin: 'BTC', side: 'B', px: '80000', sz: '5', time: 1_700_000_000_000, hash: '0xabc', users: ['0xwhale', '0xm1'] },
      { coin: 'BTC', side: 'B', px: '80010', sz: '10', time: 1_700_000_000_000, hash: '0xabc', users: ['0xwhale', '0xm2'] },
      { coin: 'ETH', side: 'A', px: '2500', sz: '400', time: 1_700_000_001_000, hash: '0xdef', users: ['0xm3', '0xseller'] },
    ];
    const orders = groupFills(fills);
    assert.equal(orders.length, 2);
    const btc = orders.find((o) => o.symbol === 'BTC');
    assert.deepEqual([btc.side, btc.amount, btc.address], ['buy', 15, '0xwhale']);
    assert.equal(btc.usd, 80000 * 5 + 80010 * 10);
    const eth = orders.find((o) => o.symbol === 'ETH');
    assert.deepEqual([eth.side, eth.address], ['sell', '0xseller']);
  });

  test('per-thousand markets are scaled back to coins', () => {
    const markets = hyperliquidMarkets(['BTC', 'PEPE', 'TON'], [{ name: 'BTC' }, { name: 'kPEPE' }]);
    assert.deepEqual(markets.get('PEPE'), { market: 'kPEPE', scale: 1000 });
    assert.equal(markets.has('TON'), false);
    const [o] = groupFills(
      [{ coin: 'kPEPE', side: 'B', px: '0.01', sz: '100000000', time: 1, hash: '0x1', users: ['0xa', '0xb'] }],
      { scaleOf: () => 1000, symbolOf: () => 'PEPE' },
    );
    assert.deepEqual([o.symbol, o.amount, o.usd], ['PEPE', 100_000_000_000, 1_000_000]);
  });

  test('wallets link to the right explorer', () => {
    assert.match(walletLink({ source: 'hyperliquid', address: '0xa' }), /hypurrscan/);
    assert.match(walletLink({ source: 'dex', network: 'solana', address: 'abc' }), /solscan/);
    assert.equal(walletLink({ source: 'cex', network: 'unknownchain', address: 'x' }), null);
  });
});

describe('spot trades on decentralised exchanges', () => {
  const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
  const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
  const trade = (from, to, fromAmt, toAmt, usd, who, when, hash) => ({
    attributes: {
      from_token_address: from, to_token_address: to, from_token_amount: fromAmt, to_token_amount: toAmt,
      volume_in_usd: String(usd), tx_from_address: who, block_timestamp: when, tx_hash: hash,
    },
  });

  test('the coin coming in is a buy, going out a sell, whatever the pool calls it', () => {
    const json = {
      data: [
        trade(USDT, WETH, '1098152', '421.21', 1_098_152, '0xa', '2026-09-18T18:32:59Z', '0x1'),
        trade(WETH, USDT, '305', '787971', 787_971, '0xb', '2026-09-18T15:33:23Z', '0x2'),
        trade(USDT, WETH, '300000', '100', 300_000, '0xc', '2026-09-18T15:00:00Z', '0x3'),
      ],
    };
    const rows = tradesOf(json, { symbol: 'ETH', token: WETH, network: 'eth', dex: 'uniswap_v3' });
    assert.deepEqual(rows.map((r) => [r.side, r.amount]), [['buy', 421.21], ['sell', 305]]);
  });

  test('a wallet in and out of the same coin within ten minutes is a bot, both legs', () => {
    const rows = [
      row('ETH', 'buy', 1e6, 1000, { address: '0xBot' }), row('ETH', 'sell', 1e6, 1300, { address: '0xbot' }),
      row('ETH', 'buy', 1e6, 1000, { address: '0xholder' }), row('ETH', 'sell', 1e6, 9000, { address: '0xholder' }),
    ];
    assert.deepEqual(withoutBots(rows).map((r) => r.address), ['0xholder', '0xholder']);
  });

  test('bitcoin is found through its wrapped tokens, other coins through their contracts', () => {
    assert.ok(tokensFor({ symbol: 'BTC' }, {}).some(([n]) => n === 'eth'));
    assert.deepEqual(tokensFor({ symbol: 'LINK' }, { ethereum: '0x514910771af9ca656af840dff83e8264ecf986ca', 'some-chain': '0x1' }),
      [['eth', '0x514910771af9ca656af840dff83e8264ecf986ca']]);
  });
});

describe('leveraged: open, close, long, short', () => {
  test('a Hyperliquid fill says what the order did', async () => {
    const { hyperliquidAction } = await import('../src/services/whaleTrades.js');
    assert.deepEqual(hyperliquidAction({ dir: 'Open Long', startPosition: '0' }, 5), { verb: 'open', side: 'long' });
    assert.deepEqual(hyperliquidAction({ dir: 'Open Short', startPosition: '-2' }, 5), { verb: 'add', side: 'short' });
    assert.deepEqual(hyperliquidAction({ dir: 'Close Short', startPosition: '-5' }, 5), { verb: 'close', side: 'short' });
    assert.deepEqual(hyperliquidAction({ dir: 'Close Long', startPosition: '8' }, 5), { verb: 'reduce', side: 'long' });
    assert.deepEqual(hyperliquidAction({ dir: 'Long > Short', startPosition: '3' }, 8), { verb: 'flip', side: 'short' });
  });

  test('a close of a short is bullish, an open of one bearish', async () => {
    const { leveragedLabel, summariseLeveraged } = await import('../src/services/whaleTrades.js');
    assert.deepEqual(leveragedLabel({ verb: 'close', side: 'short' }), { text: 'CLOSE SHORT', bullish: true, opening: false });
    assert.deepEqual(leveragedLabel({ verb: 'open', side: 'short' }), { text: 'OPEN SHORT', bullish: false, opening: true });
    const s = summariseLeveraged([
      { verb: 'open', side: 'long', usd: 2e6 }, { verb: 'open', side: 'short', usd: 1e6 }, { verb: 'close', side: 'long', usd: 3e6 },
    ]);
    assert.deepEqual([s.longUsd, s.shortUsd, s.closedUsd], [2e6, 1e6, 3e6]);
  });

  test('GMX orders are read as open, add, reduce, close and liquidation', async () => {
    const { actionOf, coinSymbol } = await import('../api/_lib/gmxlev.js');
    const usd = (n) => (BigInt(n) * 10n ** 30n).toString();
    assert.deepEqual(actionOf({ orderType: 2, isLong: true, positionSizeInUsd: usd(1_000_000), sizeDeltaUsd: usd(1_000_000) }), { verb: 'open', side: 'long' });
    assert.deepEqual(actionOf({ orderType: 2, isLong: true, positionSizeInUsd: usd(3_000_000), sizeDeltaUsd: usd(1_000_000) }), { verb: 'add', side: 'long' });
    assert.deepEqual(actionOf({ orderType: 4, isLong: false, positionSizeInUsd: usd(0), sizeDeltaUsd: usd(700_000) }), { verb: 'close', side: 'short' });
    assert.deepEqual(actionOf({ orderType: 5, isLong: false, positionSizeInUsd: usd(200_000), sizeDeltaUsd: usd(700_000) }), { verb: 'reduce', side: 'short' });
    assert.deepEqual(actionOf({ orderType: 7, isLong: false, positionSizeInUsd: usd(0), sizeDeltaUsd: usd(1_000_000) }), { verb: 'liquidated', side: 'short' });
    assert.equal(actionOf({ orderType: 0, isLong: true }), null, 'a swap is not a position');
    assert.equal(coinSymbol('WBTC.b'), 'BTC');
    assert.equal(coinSymbol('WETH'), 'ETH');
  });
});

test('a leveraged order whose open or close is unknown shows as a plain buy or sell', async () => {
  const { leveragedLabel } = await import('../src/services/whaleTrades.js');
  assert.equal(leveragedLabel({ verb: 'unknown', side: 'long' }).text, 'BUY');
  assert.equal(leveragedLabel({ verb: 'unknown', side: 'short' }).text, 'SELL');
});

describe('what a leveraged row says', () => {
  const load = () => import('../src/services/whaleTrades.js');

  test('an opening names its leverage, entry and liquidation price', async () => {
    const { leverageText, positionStory } = await load();
    const row = { verb: 'open', side: 'long', usd: 6e6, leverage: 40, entry: 78835.4, liq: 78258.97 };
    assert.equal(leverageText(row), '40×');
    assert.equal(positionStory(row), 'entry $78,835 · liquidation $78,259');
  });

  test('a close says what it made, and what that was on the margin put up', async () => {
    const { positionStory } = await load();
    // $5M at 10× is $500k of margin; +$117k on that is +23%.
    assert.equal(positionStory({ verb: 'close', side: 'long', usd: 5e6, leverage: 10, pnl: 117_000 }),
      'Closed — profit $117k (+23% of margin)');
    assert.equal(positionStory({ verb: 'reduce', side: 'short', usd: 2e6, leverage: 4, pnl: -50_000 }),
      'Took some off — loss $50k (−10% of margin)');
  });

  test('a liquidation says so plainly', async () => {
    const { positionStory } = await load();
    assert.equal(positionStory({ verb: 'liquidated', side: 'long', usd: 5.88e6, leverage: 71, pnl: -63_313 }),
      'Wiped out — lost $63k');
  });

  test('a position still open carries its running profit; one since closed says that', async () => {
    const { positionStory } = await load();
    const open = { verb: 'open', side: 'long', usd: 1e6, leverage: 5, entry: 100, live: { pnl: 42_000, roe: 0.21 } };
    assert.equal(positionStory(open), 'entry $100 · now +$42k (+21% of margin)');
    assert.equal(positionStory({ ...open, live: { gone: true } }), 'entry $100 · position since closed');
  });

  test('unknown leverage is simply left out', async () => {
    const { leverageText, positionStory } = await load();
    assert.equal(leverageText({ usd: 1e6 }), '');
    assert.equal(positionStory({ verb: 'close', usd: 1e6, pnl: 10_000 }), 'Closed — profit $10k');
  });
});

describe('leverage from a GMX trade itself', () => {
  test("the size moved over the collateral moved with it — a closed position has no other source", async () => {
    const { leverageOf } = await import('../api/_lib/gmxlev.js');
    // The real liquidation of 20 Sep 2026: $5,876,449 on $74,449 of USDC.
    const lev = leverageOf({
      sizeDeltaUsd: (5_876_449n * 10n ** 30n).toString(),
      initialCollateralDeltaAmount: '74458504519',
      collateralTokenPriceMin: '999876455000000000000000',
    });
    assert.ok(Math.abs(lev - 78.9) < 0.2, `got ${lev}`);
  });

  test('no collateral on the trade means no leverage claimed', async () => {
    const { leverageOf } = await import('../api/_lib/gmxlev.js');
    assert.equal(leverageOf({ sizeDeltaUsd: (1_000_000n * 10n ** 30n).toString(), initialCollateralDeltaAmount: '0', collateralTokenPriceMin: '0' }), null);
    assert.equal(leverageOf({}), null);
  });
});

describe('one row per position', () => {
  const ev = (id, at, verb, usd, extra = {}) => ({
    id, at, verb, usd, side: 'long', symbol: 'ETH', address: '0xWhale', source: 'hyperliquid', network: null, amount: usd / 2500, ...extra,
  });

  test('adds and partial closes join the position they belong to', async () => {
    const { buildPositions } = await import('../src/services/whaleTrades.js');
    const positions = buildPositions([
      ev('a', 100, 'open', 5e6, { leverage: 25, entry: 2582 }),
      ev('b', 200, 'add', 2e6),
      ev('c', 300, 'reduce', 1e6, { pnl: -95_000 }),
    ]);
    assert.equal(positions.length, 1);
    const [p] = positions;
    assert.deepEqual([p.usd, p.pnl, p.closed, p.leverage, p.events.length], [7e6, -95_000, false, 25, 3]);
    assert.equal(p.openedAt, 100);
    assert.equal(p.at, 300, 'the row is ordered by its latest move');
  });

  test('a close ends it, and the next opening is a new row', async () => {
    const { buildPositions, positionSummary } = await import('../src/services/whaleTrades.js');
    const positions = buildPositions([
      ev('a', 100, 'open', 5e6), ev('b', 200, 'close', 5e6, { pnl: 120_000 }),
      ev('c', 300, 'open', 3e6),
    ]);
    assert.equal(positions.length, 2);
    assert.equal(positions[0].openedAt, 300, 'newest first');
    assert.equal(positionSummary(positions[1]).text, 'CLOSED LONG');
    assert.equal(positions[1].pnl, 120_000);
  });

  test('a liquidation is named as one', async () => {
    const { buildPositions, positionSummary } = await import('../src/services/whaleTrades.js');
    const [p] = buildPositions([ev('a', 100, 'open', 5e6), ev('b', 200, 'liquidated', 5e6, { pnl: -63_000 })]);
    assert.equal(positionSummary(p).text, 'LONG LIQUIDATED');
    assert.equal(p.closed, true);
  });

  test('two wallets, two coins and two sides never share a row', async () => {
    const { buildPositions } = await import('../src/services/whaleTrades.js');
    const positions = buildPositions([
      ev('a', 100, 'open', 5e6),
      ev('b', 110, 'open', 5e6, { address: '0xOther' }),
      ev('c', 120, 'open', 5e6, { symbol: 'BTC' }),
      ev('d', 130, 'open', 5e6, { side: 'short' }),
    ]);
    assert.equal(positions.length, 4);
  });

  test('a close with no opening in the window still gets its row', async () => {
    const { buildPositions } = await import('../src/services/whaleTrades.js');
    const [p] = buildPositions([ev('a', 100, 'close', 5e6, { pnl: 10_000 })]);
    assert.deepEqual([p.partial, p.closed, p.usd], [true, true, 5e6]);
  });
});
